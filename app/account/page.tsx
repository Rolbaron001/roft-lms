import Link from "next/link";
import { requireSession, requireTenant } from "@/lib/request";
import { extensionState, knownProviders } from "@/lib/extensions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { MyExtension } from "./my-extension";

/**
 * Your own account.
 *
 * Everything here belongs to the person reading it rather than to the tenant,
 * which is why the AI extension lives here and not in Settings. Settings is
 * where an administrator decides things on everybody's behalf; this is where
 * you decide things on your own.
 */
export default async function AccountPage() {
  const tenant = await requireTenant();
  const session = await requireSession();

  const mayUseExtension = session.permissions.includes("extension:use");
  const extension = mayUseExtension ? await extensionState(session) : null;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Your account</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {session.firstName} {session.lastName} · {session.email}
        </p>
      </div>

      <Card
        title="Password"
        description="Changing it signs out every other session you have open."
      >
        <Link href="/account/password" className="text-sm underline">
          Change your password
        </Link>
      </Card>

      {extension ? (
        <div className="mt-6">
          <Card
            title="Your AI extension"
            description="Optional, off by default, and yours rather than the tenant's. Every member of staff sets their own."
          >
            <MyExtension
              current={{
                enabled: extension.enabled,
                provider: extension.provider,
                model: extension.model,
                allowedImportRoots: extension.allowedImportRoots,
                availability: extension.availability,
                providers: knownProviders().map((provider) => ({
                  name: provider.name,
                  label: provider.label,
                  description: provider.description,
                })),
              }}
            />
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
