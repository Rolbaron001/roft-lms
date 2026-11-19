"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n";

/** Back to wherever the document was opened from. */
export function BackLink() {
  const t = useT();
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.back()} className="text-sm text-[var(--muted)] hover:underline">
      {t("common.back")}
    </button>
  );
}
