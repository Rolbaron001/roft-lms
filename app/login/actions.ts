"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requestContext, currentTenant } from "@/lib/request";
import { signIn, signOut, SESSION_COOKIE } from "@/lib/session";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export type LoginState = { error?: string };

/**
 * Sign-in.
 *
 * Every failure returns the same message. Telling someone that an address is
 * unknown, or that an account is locked, hands an attacker a way to enumerate
 * who holds accounts with this client.
 */
export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const tenant = await currentTenant();
  if (!tenant) {
    return { error: "This address does not belong to a known organisation." };
  }

  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Enter your email address and password." };
  }

  const context = await requestContext();
  const result = await signIn(
    tenant.id,
    parsed.data.email,
    parsed.data.password,
    context,
  );

  if (!result.ok) {
    return {
      error:
        result.reason === "locked"
          ? "Too many attempts. Wait fifteen minutes and try again."
          : "Those details are not correct.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Matches the session's absolute lifetime in lib/session.ts.
    maxAge: 12 * 60 * 60,
  });

  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const tenant = await currentTenant();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (tenant && token) {
    await signOut(tenant.id, token, await requestContext());
  }

  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
