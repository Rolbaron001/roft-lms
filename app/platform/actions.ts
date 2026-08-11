"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import {
  createTenant,
  ProvisioningError,
  setTenantStatus,
  updateTenant,
  type TenantInput,
} from "@/lib/provisioning";
import { PermissionDeniedError } from "@/lib/rbac";

export type PlatformState = {
  error?: string;
  notice?: string;
  /** Shown once. There is no mail server to send it. */
  password?: string;
  tenantUrl?: string;
};

function describe(error: unknown): string {
  if (error instanceof PermissionDeniedError) {
    return "Only the Platform Owner can do that.";
  }
  if (error instanceof ProvisioningError) {
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

function readTenantFields(formData: FormData): TenantInput {
  const text = (name: string) => {
    const value = String(formData.get(name) ?? "").trim();
    return value.length > 0 ? value : undefined;
  };

  return {
    slug: String(formData.get("slug") ?? ""),
    legalName: String(formData.get("legalName") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    deploymentMode: (formData.get("deploymentMode") as "shared_cloud") ||
      "shared_cloud",
    primaryColour: String(formData.get("primaryColour") ?? "#0D1E32"),
    accentColour: String(formData.get("accentColour") ?? "#B9975B"),
    logoUrl: text("logoUrl"),
    customDomain: text("customDomain"),
    accreditationNumber: text("accreditationNumber"),
    wardCode: text("wardCode"),
    qualityAssurancePartner: text("qualityAssurancePartner"),
    dataRetentionYears: Number(formData.get("dataRetentionYears") ?? 5),
    featureFlags: {
      qcto_portfolio: formData.get("qcto_portfolio") === "on",
      statutory_reporting: formData.get("statutory_reporting") === "on",
      learning_paths: formData.get("learning_paths") === "on",
    },
  };
}

export async function createTenantAction(
  _previous: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const session = await requireSession();

  try {
    const fields = readTenantFields(formData);
    const { initialPassword } = await createTenant(session, fields, {
      email: String(formData.get("adminEmail") ?? ""),
      firstName: String(formData.get("adminFirstName") ?? ""),
      lastName: String(formData.get("adminLastName") ?? ""),
    });

    revalidatePath("/platform");

    return {
      notice: `${fields.displayName} is set up.`,
      password: initialPassword,
      tenantUrl: fields.slug,
    };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function updateTenantAction(
  _previous: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const session = await requireSession();
  const tenantId = String(formData.get("tenantId") ?? "");

  try {
    await updateTenant(session, tenantId, readTenantFields(formData));
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath("/platform");
  revalidatePath(`/platform/${tenantId}`);
  return { notice: "Saved." };
}

export async function setTenantStatusAction(
  _previous: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const session = await requireSession();
  const tenantId = String(formData.get("tenantId") ?? "");
  const status = String(formData.get("status") ?? "") as
    | "active"
    | "suspended"
    | "closed";

  try {
    await setTenantStatus(
      session,
      tenantId,
      status,
      String(formData.get("reason") ?? ""),
    );
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath("/platform");
  revalidatePath(`/platform/${tenantId}`);
  return {
    notice:
      status === "active"
        ? "Reactivated. Their address works again."
        : "Suspended. Nobody there can reach a login page now.",
  };
}
