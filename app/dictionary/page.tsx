import { requirePermission, requireTenant } from "@/lib/request";
import { AppShell } from "@/components/app-shell";
import { DEFINED_BY_MEANING, getDictionary } from "@/lib/dictionary";
import { DictionaryBrowser } from "./dictionary-browser";

export const metadata = { title: "Dictionary" };

export default async function DictionaryPage() {
  const tenant = await requireTenant();
  // Everyone signed in holds report:own. The dictionary is a reference, not a
  // record: there is nothing in it to withhold from a learner.
  const session = await requirePermission("report:own");

  const dictionary = getDictionary();

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Dictionary</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          The settled meaning of every term used across this platform, its
          documents and its learning material. Each entry says who owns the
          word. Where an authority defines it, we use it as they do and the
          body is named. Where the word is ours, we can change it. Where it is
          simply common usage, it should never be cited as a requirement.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Version {dictionary.version}, issued {dictionary.issued} —{" "}
          {dictionary.entries.length} terms.
        </p>
      </div>

      <DictionaryBrowser
        entries={dictionary.entries}
        categories={dictionary.categories}
        meanings={DEFINED_BY_MEANING}
      />
    </AppShell>
  );
}
