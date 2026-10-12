"use client";

import { useEffect } from "react";
import { useT } from "./i18n";

/**
 * Tab accepts a field's suggestion (Roland, 12 October 2026). A field marked
 * `data-suggest` shows its suggestion as grey placeholder text; pressing Tab
 * in it while it is empty fills the suggestion in and keeps the cursor there,
 * and a second Tab moves on as usual.
 *
 * `data-suggest="value"` fills that value. `data-suggest` with no value fills
 * the placeholder itself, taking only what follows "e.g. " where the
 * placeholder says that, so "Sitting name, e.g. March 2027" fills "March 2027".
 *
 * Only fields whose placeholder is a value worth keeping are marked: not an
 * instruction ("Reason, if refusing"), and not a made-up example of a code
 * or address, which would put an invented value on the record.
 */
export function suggestionOf(field: HTMLInputElement | HTMLTextAreaElement): string {
  // React writes a bare `data-suggest` as "true": that means the placeholder.
  const explicit = field.dataset.suggest;
  if (explicit && explicit !== "true") return explicit;
  const placeholder = field.placeholder ?? "";
  const example = placeholder.match(/e\.g\.\s*(.+)$/i);
  return (example ? example[1] : placeholder).trim();
}

export function SuggestionTab() {
  const t = useT();
  const hint = t("suggest.tab");

  useEffect(() => {
    const isSuggesting = (target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement =>
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.dataset.suggest !== undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const field = event.target;
      if (!isSuggesting(field) || field.value !== "" || field.readOnly || field.disabled) return;
      const value = suggestionOf(field);
      if (!value) return;
      event.preventDefault();
      // The native setter, so a field React controls hears the change too.
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      if (field.type !== "number") field.setSelectionRange(value.length, value.length);
    };

    const onFocus = (event: FocusEvent) => {
      const field = event.target;
      if (isSuggesting(field) && !field.title) field.title = hint;
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus, true);
    };
  }, [hint]);

  return null;
}
