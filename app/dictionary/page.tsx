import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { AppShell } from "@/components/app-shell";
import { getDictionary, type DefinedBy } from "@/lib/dictionary";
import { DictionaryBrowser } from "./dictionary-browser";

export const metadata = { title: "Dictionary" };

export default async function DictionaryPage() {
  const tenant = await requireTenant();
  // Everyone signed in holds report:own. The dictionary is a reference, not a
  // record: there is nothing in it to withhold from a learner.
  const session = await requirePermission("report:own");
  const t = await pageT();

  const dictionary = getDictionary();
  const meanings: Record<DefinedBy, string> = {
    authority: t("dictionary.meaning.authority"),
    platform: t("dictionary.meaning.platform"),
    practice: t("dictionary.meaning.practice"),
  };

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("dictionary.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{t("dictionary.intro")}</p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {t("dictionary.version", {
            version: dictionary.version,
            issued: dictionary.issued,
            count: dictionary.entries.length,
          })}
        </p>
      </div>

      <DictionaryBrowser
        entries={dictionary.entries}
        categories={dictionary.categories}
        meanings={meanings}
      />
    </AppShell>
  );
}
