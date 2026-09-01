"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, requireSession } from "@/lib/request";
import {
  anonymisePerson,
  invitePerson,
  PeopleError,
  resetPassword,
  setMailboxAddress,
  setPersonStatus,
  setRoles,
  updatePerson,
  type Role,
} from "@/lib/people";
import { PermissionDeniedError } from "@/lib/rbac";
import {
  DocumentError,
  recordEnrolmentDocument,
  verifyEnrolmentDocument,
} from "@/lib/enrolment-documents";

export type PeopleState = {
  error?: string;
  notice?: string;
  /** Shown once, then gone: there is no mail server to send it. */
  password?: string;
};

function describe(error: unknown): string {
  if (error instanceof PermissionDeniedError) {
    return "Your role does not allow that.";
  }
  if (error instanceof PeopleError) {
    return error.message;
  }
  if (error && typeof error === "object" && "issues" in error) {
    return (error as { issues: { message: string }[] }).issues
      .map((issue) => issue.message)
      .join(" ");
  }
  console.error(error);
  return "That could not be saved. Please try again.";
}

function readPersonFields(formData: FormData) {
  const text = (name: string) => {
    const value = String(formData.get(name) ?? "").trim();
    return value.length > 0 ? value : undefined;
  };

  return {
    email: String(formData.get("email") ?? ""),
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    jobTitle: text("jobTitle"),
    team: text("team"),
    site: text("site"),
    lineManagerId: text("lineManagerId"),
    ofoCode: text("ofoCode"),
    nationalId: text("nationalId"),
    gender: text("gender"),
    equityCode: text("equityCode"),
    disabilityCode: text("disabilityCode"),
    nationality: text("nationality"),
  };
}

export async function invitePersonAction(
  _previous: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  const session = await requireSession();

  try {
    const { initialPassword } = await invitePerson(session, {
      ...readPersonFields(formData),
      roles: formData.getAll("roles").map(String) as Role[],
    });

    revalidatePath("/people");
    return {
      notice: "Added.",
      password: initialPassword,
    };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function updatePersonAction(
  _previous: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  const session = await requireSession();
  const userId = String(formData.get("userId") ?? "");

  try {
    await updatePerson(session, userId, {
      ...readPersonFields(formData),
      roles: [],
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/people/${userId}`);
  revalidatePath("/people");
  return { notice: "Saved." };
}

export async function setRolesAction(
  _previous: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  const session = await requireSession();
  const userId = String(formData.get("userId") ?? "");
  const roles = formData.getAll("roles").map(String) as Role[];

  const registrationNumbers: Partial<Record<Role, string>> = {};
  for (const role of ["assessor", "moderator"] as const) {
    const value = String(formData.get(`registration:${role}`) ?? "").trim();
    if (value) registrationNumbers[role] = value;
  }

  try {
    await setRoles(session, userId, roles, registrationNumbers);
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/people/${userId}`);
  return { notice: "Roles updated. They take effect on the person's next page." };
}

export async function setStatusAction(
  _previous: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  const session = await requireSession();
  const userId = String(formData.get("userId") ?? "");
  const status = formData.get("status") === "suspended" ? "suspended" : "active";

  try {
    await setPersonStatus(session, userId, status);
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/people/${userId}`);
  revalidatePath("/people");
  return {
    notice:
      status === "suspended"
        ? "Suspended. Any session they had open has ended."
        : "Reactivated.",
  };
}

export async function resetPasswordAction(
  _previous: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  const session = await requireSession();

  try {
    const password = await resetPassword(
      session,
      String(formData.get("userId") ?? ""),
    );
    return { notice: "New password set.", password };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function setMailboxAction(
  _previous: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  const session = await requireSession();
  const userId = String(formData.get("userId") ?? "");
  const address = String(formData.get("mailboxAddress") ?? "").trim();

  try {
    await setMailboxAddress(session, userId, address || null);
    revalidatePath(`/people/${userId}`);
    return {
      notice: address
        ? `Mailbox set to ${address.toLowerCase()}.`
        : "Mailbox removed.",
    };
  } catch (error) {
    // Addresses are unique across the whole platform, because an address is a
    // destination on the internet and two people cannot both own one.
    if (String((error as { cause?: unknown }).cause).includes("duplicate key")) {
      return { error: "That address is already in use." };
    }
    return { error: describe(error) };
  }
}

export async function anonymiseAction(
  _previous: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  const session = await requireSession();
  const userId = String(formData.get("userId") ?? "");

  // Typing the person's surname is the confirmation. A dialog gets clicked
  // through; this is irreversible.
  const confirmation = String(formData.get("confirmation") ?? "").trim();
  const expected = String(formData.get("expectedConfirmation") ?? "").trim();

  if (confirmation.toLowerCase() !== expected.toLowerCase()) {
    return {
      error: `Type "${expected}" to confirm. Anonymising cannot be undone.`,
    };
  }

  try {
    await anonymisePerson(
      session,
      userId,
      String(formData.get("reason") ?? ""),
    );
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath("/people");
  redirect("/people");
}

// ---------------------------------------------------------------------------
// Enrolment documents
// ---------------------------------------------------------------------------

export type PeopleActionState = { error?: string; done?: string };

function describeDocument(error: unknown): string {
  if (error instanceof PermissionDeniedError) {
    return "Your role does not allow that.";
  }
  if (error instanceof DocumentError) return error.message;
  if (error && typeof error === "object" && "issues" in error) {
    return (error as { issues: { message: string }[] }).issues
      .map((issue) => issue.message)
      .join(" ");
  }
  console.error(error);
  return "That could not be saved. Please try again.";
}

export async function recordDocumentAction(
  _previous: PeopleActionState,
  formData: FormData,
): Promise<PeopleActionState> {
  const session = await requirePermission("enrolment:manage");
  const userId = String(formData.get("userId") ?? "");
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file." };
  }

  try {
    await recordEnrolmentDocument(session, {
      userId,
      kind: String(formData.get("kind") ?? "other") as "other",
      filename: file.name,
      certifiedOn: String(formData.get("certifiedOn") ?? "") || undefined,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  } catch (error) {
    return { error: describeDocument(error) };
  }

  revalidatePath(`/people/${userId}`);
  return { done: "Document filed." };
}

export async function verifyDocumentAction(
  _previous: PeopleActionState,
  formData: FormData,
): Promise<PeopleActionState> {
  const session = await requirePermission("enrolment:manage");
  const userId = String(formData.get("userId") ?? "");

  try {
    await verifyEnrolmentDocument(
      session,
      String(formData.get("documentId") ?? ""),
      String(formData.get("outcome") ?? "accepted") as "accepted",
      String(formData.get("reason") ?? "") || undefined,
    );
  } catch (error) {
    return { error: describeDocument(error) };
  }

  revalidatePath(`/people/${userId}`);
  return { done: "Checked." };
}
