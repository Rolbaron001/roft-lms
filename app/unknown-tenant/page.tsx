import { pageT } from "@/lib/request";

export default async function UnknownTenantPage() {
  const t = await pageT();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">{t("access.unknownTitle")}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{t("access.unknownNote")}</p>
      </div>
    </main>
  );
}
