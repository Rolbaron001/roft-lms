import Link from "next/link";
import { pageT } from "@/lib/request";

export default async function NotPermittedPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const t = await pageT();
  const { reason } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">{t("access.deniedTitle")}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{t(reason === "assigned" ? "access.notAssigned" : "access.deniedNote")}</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md px-4 py-2 text-sm font-semibold text-white"
          style={{ background: "var(--brand-primary)" }}
        >
          {t("access.home")}
        </Link>
      </div>
    </main>
  );
}
