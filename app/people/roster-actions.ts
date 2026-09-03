"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import {
  commitRoster,
  proposeRoster,
  RosterError,
  type RosterProposal,
} from "@/lib/roster-import";
import { PermissionDeniedError } from "@/lib/rbac";

export type RosterActionState = {
  error?: string;
  notice?: string;
  /**
   * What was read, held in the form's state between reading and committing.
   *
   * Kept here rather than in the database because it is a few hundred rows
   * that exist for one minute, and because a roster carries identity numbers -
   * there is no reason for a copy of it to outlive the import.
   */
  proposal?: RosterProposal;
  /** The passwords created, shown once and never stored anywhere readable. */
  passwords?: { email: string; initialPassword: string }[];
};

function explain(error: unknown): RosterActionState {
  if (error instanceof RosterError) return { error: error.message };
  if (error instanceof PermissionDeniedError) {
    return { error: "Your role does not allow that." };
  }
  console.error(error);
  return {
    error:
      error instanceof Error
        ? error.message
        : "That file could not be read. Please try again.",
  };
}

export async function readRosterAction(
  _previous: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  const session = await requirePermission("user:invite");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a spreadsheet." };
  }

  try {
    const proposal = await proposeRoster(session, {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    const usable = proposal.rows.filter((row) => row.problems.length === 0);
    return {
      proposal,
      notice: `Read ${proposal.rows.length} rows, ${usable.length} of them usable. Check what it found before creating anybody.`,
    };
  } catch (error) {
    return explain(error);
  }
}

export async function commitRosterAction(
  previous: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  const session = await requirePermission("user:invite");

  if (!previous.proposal) {
    return { error: "Read a spreadsheet first." };
  }

  // What was read is carried in the action's own state rather than re-read
  // from the form, so nothing about the file can change between somebody
  // checking it and pressing the button. The role is the one thing chosen
  // here: a roster is usually learners and is sometimes a panel of assessors.
  const role = String(formData.get("role") ?? "learner");

  try {
    const report = await commitRoster(session, previous.proposal, {
      roles: [role],
    });
    revalidatePath("/people");

    const refused =
      report.refused.length > 0
        ? ` ${report.skipped} were skipped: ${report.refused.slice(0, 6).join(" ")}${report.refused.length > 6 ? ` And ${report.refused.length - 6} more.` : ""}`
        : "";

    return {
      notice: `Created ${report.created} ${report.created === 1 ? "person" : "people"}.${refused}`,
      passwords: report.people.map((person) => ({
        email: person.email,
        initialPassword: person.initialPassword,
      })),
    };
  } catch (error) {
    return { ...explain(error), proposal: previous.proposal };
  }
}
