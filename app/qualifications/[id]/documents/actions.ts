"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import {
  uploadProgrammeDocument,
  ProgrammeDocumentError,
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
} from "@/lib/programme-documents";
import {
  AlignmentMatrixError,
  importAlignmentMatrix,
  type ProposedAddition,
} from "@/lib/alignment-matrix";
import { OfficeReadError } from "@/lib/office";
import { readProgrammeDocument } from "@/lib/programme-documents";

export type AdditionsState = { error?: string; message?: string };

/**
 * Adds the lines the provider ticked, from the matrix already filed.
 *
 * Read again from the stored document rather than from anything the browser
 * sends back, so what is added is exactly what the matrix says: the form
 * posts only which lines were chosen.
 */
export async function confirmMatrixAdditionsAction(
  _previous: AdditionsState,
  formData: FormData,
): Promise<AdditionsState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = String(formData.get("qualificationId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const keys = formData.getAll("add").map(String);

  if (keys.length === 0) {
    return { error: "Tick at least one line to add, or leave the curriculum as it is." };
  }

  try {
    const document = await readProgrammeDocument(session, documentId);
    const summary = await importAlignmentMatrix(session, qualificationId, document.bytes, keys);
    revalidatePath(`/qualifications/${qualificationId}`);
    return {
      message: `${summary.added} ${summary.added === 1 ? "line" : "lines"} added to the curriculum, each marked as the provider's own with the reason the matrix gives. Their coverage is recorded.`,
    };
  } catch (error) {
    if (error instanceof AlignmentMatrixError || error instanceof ProgrammeDocumentError) {
      return { error: error.message };
    }
    throw error;
  }
}

export type UploadState = {
  error?: string;
  message?: string;
  /** Reported when the file was an alignment matrix and was read. */
  detail?: string[];
  /**
   * Where to go now.
   *
   * Roland, 21 September: "there is no clear navigation after the upload
   * message. The display still looks like I should be doing something else on
   * the page. Put a navigation button to go back to the Qualification, or
   * somewhere that will address the issues displayed."
   *
   * The form reported what happened and then left him standing in an upload
   * form, beside a pointer still telling him to upload the thing he had just
   * uploaded. A result that finishes a task has to offer the way out of it -
   * and where the result lists problems, the way out is to wherever those
   * problems get fixed, not merely back to the top.
   */
  links?: { href: string; label: string }[];
  /**
   * Lines the matrix names that the curriculum does not have, for the
   * provider to tick and confirm. Roland, 26 September: hold what the
   * provider wants loaded, after they confirm it during the upload.
   */
  additions?: {
    qualificationId: string;
    documentId: string;
    items: ProposedAddition[];
  };
};

export async function uploadDocumentAction(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const session = await requirePermission("qualification:manage");

  const qualificationId = String(formData.get("qualificationId") ?? "");
  const attachTo = String(formData.get("attachTo") ?? "");
  const kind = String(formData.get("kind") ?? "") as DocumentKind;
  const title = String(formData.get("title") ?? "").trim();
  const version = String(formData.get("version") ?? "").trim();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  // attachTo carries "qualification", "unit:<id>" or "module:<id>", so the one
  // scope the library allows is decided here rather than by three optional
  // fields that could all arrive at once.
  const scope = attachTo.startsWith("unit:")
    ? { studyUnitId: attachTo.slice(5) }
    : attachTo.startsWith("module:")
      ? { curriculumModuleId: attachTo.slice(7) }
      : { qualificationId };

  try {
    const result = await uploadProgrammeDocument(
      session,
      {
        kind,
        title: title || file.name,
        version: version || undefined,
        ...scope,
      },
      {
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
    );

    revalidatePath(`/qualifications/${qualificationId}`);

    /*
     * An alignment document builds the study units, and this said nothing
     * about it.
     *
     * Roland, 20 September: "The document is uploaded but nothing seems to
     * happen from it. The navigation still shows outstanding study units."
     * Two faults, and this is the second. `uploadProgrammeDocument` has
     * returned an `alignment` summary all along - five study units, their exit
     * level outcomes, the modules linked under each - and this action read
     * only `matrix`, so the one message he got back was "uploaded.".
     *
     * That is worse than an error would have been. An upload that did its
     * whole job and an upload that did nothing produced the same sentence, so
     * there was no way to tell them apart from the screen.
     */
    if (result.alignment) {
      const applied = result.alignment;
      const detail = [
        `${applied.studyUnitsCreated} study units created${applied.studyUnitsUpdated > 0 ? `, ${applied.studyUnitsUpdated} updated` : ""}.`,
        `${applied.outcomesRecorded} exit level outcomes recorded, ${applied.modulesLinked} modules placed under a study unit.`,
        ...applied.notes,
      ];

      if (result.reclassified) {
        detail.unshift(
          "Filed as a curriculum alignment matrix rather than the kind chosen — it names study units and exit level outcomes, so it is one.",
        );
      }

      // Nothing was built, and saying "uploaded" over the top of that is how
      // the last two days went.
      if (
        applied.studyUnitsCreated === 0 &&
        applied.studyUnitsUpdated === 0
      ) {
        return {
          error:
            "That document was filed, but no study units came out of it. It reads as an alignment document, so either the modules it names are not in the curriculum under those codes, or the study units are already there. The detail is in the document library entry.",
        };
      }

      /*
       * Where to go, chosen by what actually happened.
       *
       * Study units built and modules placed: the job is done, go and look at
       * it. Study units built and nothing placed: the job is half done and the
       * thing to fix is the curriculum's module codes, so the button goes to
       * the curriculum rather than to the top of the page.
       */
      const links =
        applied.modulesLinked === 0
          ? [
              {
                // The curriculum listing, where the codes are actually
                // visible. #curriculum is on the default tab, so this lands
                // on the modules rather than on a tab that has to be found.
                href: `/qualifications/${qualificationId}#curriculum`,
                label: "Check the curriculum's module codes",
              },
              {
                href: `/qualifications/${qualificationId}`,
                label: "Back to the qualification",
              },
            ]
          : [
              {
                href: `/qualifications/${qualificationId}`,
                label: "See the study units",
              },
            ];

      return {
        message:
          applied.modulesLinked === 0
            ? "Alignment document read. Study units built, but no modules placed under them."
            : "Alignment document read. Study units built.",
        detail,
        links,
      };
    }

    if (!result.matrix) {
      return {
        message: `${title || file.name} uploaded.`,
        // Said plainly, because "uploaded" reads as though something happened.
        detail: [
          `Filed as ${DOCUMENT_KIND_LABELS[result.kind]}. Nothing was read out of it — only an alignment document or an alignment matrix is read.`,
        ],
        links: [
          {
            href: `/qualifications/${qualificationId}`,
            label: "Back to the qualification",
          },
        ],
      };
    }

    const matrix = result.matrix;
    const detail = [
      matrix.sheetsRead.length > 1
        ? `Read the ${matrix.sheetsRead.map((name) => `“${name}”`).join(", ")} sheets.`
        : `Read the “${matrix.sheetName}” sheet.`,
      `Columns recognised: ${matrix.columnsRecognised.join(", ")}.`,
      `${matrix.rowsRead} rows, ${matrix.elementsMatched} curriculum lines and ${matrix.criteriaMatched} criteria matched, ${matrix.alignmentsRecorded} links recorded.`,
    ];

    if (matrix.proposedAdditions.length > 0) {
      detail.push(
        `${matrix.proposedAdditions.length} lines in the matrix are not in the curriculum as held. They are listed below: tick the ones to add. Nothing is added until you confirm.`,
      );
    }

    if (matrix.unmatchedCodes.length > 0) {
      detail.push(
        `${matrix.unmatchedCodes.length} codes in the matrix are not in the curriculum yet: ${matrix.unmatchedCodes.slice(0, 12).join(", ")}${matrix.unmatchedCodes.length > 12 ? "…" : ""}. These are usually modules nobody has transcribed.`,
      );
    }

    return {
      message: "Alignment matrix uploaded and read.",
      detail,
      links: [
        {
          href: `/qualifications/${qualificationId}`,
          label: "Back to the qualification",
        },
      ],
      additions:
        matrix.proposedAdditions.length > 0
          ? { qualificationId, documentId: result.id, items: matrix.proposedAdditions }
          : undefined,
    };
  } catch (error) {
    if (
      error instanceof ProgrammeDocumentError ||
      error instanceof AlignmentMatrixError ||
      error instanceof OfficeReadError
    ) {
      return { error: error.message };
    }
    throw error;
  }
}
