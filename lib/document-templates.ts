import { and, asc, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { documentTemplates } from "@/db/schema";
import {
  DOCUMENT_KINDS,
  STATUTORY_BLOCKS,
  unknownPlaceholders,
  type DocumentKind,
} from "./document-fields";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * A tenant's own version of the documents the platform issues.
 *
 * Roland, 10 September 2026: "Given that the LMS is built for various Tenants
 * the templates cannot be prescriptive of exactly how a document must look.
 * There must be functionality for a user to create and/or upload their own
 * which the LMS must use."
 *
 * So a document has two halves, and the split is the whole design:
 *
 *   The template is the tenant's. Their letterhead, their wording, the fields
 *   they show and the order they show them in.
 *
 *   The statutory block is the platform's. Rendered after the template, from
 *   `STATUTORY_BLOCKS`, and not editable. A provider may restyle a Statement of
 *   Results; they may not drop the sentence saying it is not an Occupational
 *   Certificate, because that sentence is the QCTO's and the person it protects
 *   is a learner standing at an assessment centre.
 *
 * What is deliberately **not** here: the QCTO's own submission workbooks. A
 * LEISA goes in the QCTO's format because the QCTO says so, and letting a
 * tenant restyle it would produce a file that is rejected on upload. Those are
 * exports, not documents, and they stay fixed.
 */

export class DocumentTemplateError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "invalid"
      | "unknown_field"
      | "not_permitted",
  ) {
    super(message);
    this.name = "DocumentTemplateError";
  }
}

export type SaveTemplateInput = {
  kind: DocumentKind;
  name: string;
  body: string;
  /** Make it the one documents are produced from, rather than leaving a draft. */
  activate?: boolean;
};

function check(input: SaveTemplateInput) {
  const name = input.name.trim();
  const body = input.body.trim();

  if (!DOCUMENT_KINDS.includes(input.kind)) {
    throw new DocumentTemplateError(
      "That is not a document the platform produces.",
      "invalid",
    );
  }
  if (name.length < 2) {
    throw new DocumentTemplateError("Give the template a name.", "invalid");
  }
  if (body.length < 20) {
    throw new DocumentTemplateError(
      "There is nothing in this template yet. A document rendered from it would be blank.",
      "invalid",
    );
  }

  /**
   * Checked on save rather than on render.
   *
   * A placeholder that does not exist renders as nothing, and a blank space on
   * a learner's certificate is not a failure anybody notices until it is in
   * their hand. Refusing here costs somebody a typo; not refusing costs a
   * reprint and an explanation.
   */
  const unknown = unknownPlaceholders(input.kind, body);
  if (unknown.length > 0) {
    throw new DocumentTemplateError(
      `This template uses ${unknown.length === 1 ? "a field" : "fields"} the platform cannot fill: ${unknown.join(", ")}. Check the spelling against the list of what is available - a field it does not recognise is left blank on the finished document rather than reported.`,
      "unknown_field",
    );
  }

  return { name, body };
}

/**
 * Saves a template, and makes it the live one where asked.
 *
 * A new version rather than an edit in place. A document already issued was
 * rendered from the template as it stood, and somebody asking a year later why
 * a certificate reads the way it does needs the version that produced it.
 */
export async function saveTemplate(
  session: AuthenticatedSession,
  input: SaveTemplateInput,
) {
  assertSessionCan(session, "tenant:manage_settings");
  const { name, body } = check(input);

  return withTenant(session.organisationId, async (tx) => {
    const [current] = await tx
      .select({ id: documentTemplates.id, version: documentTemplates.version })
      .from(documentTemplates)
      .where(
        and(
          eq(documentTemplates.organisationId, session.organisationId),
          eq(documentTemplates.kind, input.kind),
        ),
      )
      .orderBy(desc(documentTemplates.version))
      .limit(1);

    // Archived first, so the partial unique index never sees two actives.
    if (input.activate) {
      await tx
        .update(documentTemplates)
        .set({ status: "archived", updatedAt: new Date() })
        .where(
          and(
            eq(documentTemplates.organisationId, session.organisationId),
            eq(documentTemplates.kind, input.kind),
            eq(documentTemplates.status, "active"),
          ),
        );
    }

    const [saved] = await tx
      .insert(documentTemplates)
      .values({
        organisationId: session.organisationId,
        kind: input.kind,
        name,
        body,
        status: input.activate ? "active" : "draft",
        version: (current?.version ?? 0) + 1,
        supersedesId: current?.id ?? null,
        createdById: session.userId,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: input.activate
        ? "document_template.activated"
        : "document_template.saved",
      entityType: "document_template",
      entityId: saved.id,
      after: { kind: input.kind, name, version: saved.version },
    });

    return saved;
  });
}

/** Stops using a tenant's template, so the platform's own layout returns. */
export async function revertToPlatformLayout(
  session: AuthenticatedSession,
  kind: DocumentKind,
) {
  assertSessionCan(session, "tenant:manage_settings");

  return withTenant(session.organisationId, async (tx) => {
    const archived = await tx
      .update(documentTemplates)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(documentTemplates.organisationId, session.organisationId),
          eq(documentTemplates.kind, kind),
          eq(documentTemplates.status, "active"),
        ),
      )
      .returning({ id: documentTemplates.id });

    if (archived.length > 0) {
      await recordAudit(tx, {
        organisationId: session.organisationId,
        actorId: session.userId,
        action: "document_template.reverted",
        entityType: "document_template",
        entityId: archived[0].id,
        after: { kind },
      });
    }

    return { reverted: archived.length > 0 };
  });
}

/** Every template this tenant holds, newest version of each kind first. */
export async function listTemplates(session: AuthenticatedSession) {
  assertSessionCan(session, "tenant:manage_settings");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: documentTemplates.id,
        kind: documentTemplates.kind,
        name: documentTemplates.name,
        body: documentTemplates.body,
        status: documentTemplates.status,
        version: documentTemplates.version,
        updatedAt: documentTemplates.updatedAt,
      })
      .from(documentTemplates)
      .where(eq(documentTemplates.organisationId, session.organisationId))
      .orderBy(asc(documentTemplates.kind), desc(documentTemplates.version)),
  );
}

/**
 * The template a document of this kind is produced from, or null for the
 * platform's own layout.
 *
 * Null is the ordinary answer and not a failure: every tenant had the built-in
 * layout before this existed, and most will keep it.
 */
export async function activeTemplate(
  session: AuthenticatedSession,
  kind: DocumentKind,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [found] = await tx
      .select({
        id: documentTemplates.id,
        name: documentTemplates.name,
        body: documentTemplates.body,
        version: documentTemplates.version,
      })
      .from(documentTemplates)
      .where(
        and(
          eq(documentTemplates.organisationId, session.organisationId),
          eq(documentTemplates.kind, kind),
          eq(documentTemplates.status, "active"),
        ),
      );

    return found ?? null;
  });
}

/**
 * Fills a template's placeholders from a document's own data.
 *
 * A field the data does not carry renders as an empty string rather than as
 * the placeholder text. Showing `{{ learner.nationalId }}` on a printed
 * document because a learner has no identity number recorded would be worse
 * than showing nothing: it looks like a fault in the platform rather than a
 * gap in the record.
 */
export function fillTemplate(
  body: string,
  values: Record<string, string>,
): string {
  return body.replace(
    /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g,
    (_match, key: string) => values[key] ?? "",
  );
}

/** The sentences the platform adds after the template, whatever it says. */
export function statutoryBlocksFor(kind: DocumentKind): string[] {
  return STATUTORY_BLOCKS[kind];
}
