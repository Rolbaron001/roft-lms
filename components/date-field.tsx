"use client";

import { useId, useRef, useState } from "react";
import { useDateSettings, useDay, useT } from "./i18n";
import { orderOf, parseTypedDate, type DayOrder } from "@/lib/date-parse";

/**
 * A date, typed in the order the provider writes dates (job sheet D16).
 *
 * Roland and Heidi, 8 October 2026: the browser's own date box follows the
 * browser's language, and in South African English that is year first. Heidi
 * "absolutely hated" typing the cohort's dates that way. This field shows and
 * reads the date in the provider's style (Settings, Dates), tidies whatever
 * sensible form was typed once the person moves on, keeps a calendar to pick
 * from, and sends the server the stored form (YYYY-MM-DD) under `name`, so
 * nothing on the server changes.
 */
export function DateField({
  name,
  defaultValue,
  value,
  onChange,
  required,
  className,
  id,
  label,
  min,
  max,
  disabled,
}: {
  disabled?: boolean;
  name?: string;
  /** The stored form, YYYY-MM-DD, or empty. */
  defaultValue?: string | null;
  /** Controlled use: the stored form. */
  value?: string | null;
  onChange?: (iso: string) => void;
  required?: boolean;
  className?: string;
  id?: string;
  /** For a field with no visible label of its own. */
  label?: string;
  min?: string;
  max?: string;
}) {
  const t = useT();
  const { day } = useDay();
  const settings = useDateSettings();
  const order: DayOrder = settings.style === "iso" ? "ymd" : settings.style === "device" && settings.device ? orderOf(settings.device) : "dmy";

  const controlled = value !== undefined;
  const [own, setOwn] = useState(defaultValue ?? "");
  const iso = controlled ? (value ?? "") : own;
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const fallbackId = useId();

  const pattern =
    settings.style === "iso" ? "yyyy-mm-dd" : order === "mdy" ? "mm/dd/yyyy" : settings.style === "numeric" ? "dd/mm/yyyy" : t("dateField.example");

  function commit(next: string) {
    if (!controlled) setOwn(next);
    onChange?.(next);
  }

  function read(typed: string, input?: HTMLInputElement | null) {
    if (!typed.trim()) {
      setInvalid(false);
      input?.setCustomValidity("");
      setText(null);
      commit("");
      return;
    }
    const parsed = parseTypedDate(typed, order, settings.language);
    const outside = parsed && ((min && parsed < min) || (max && parsed > max));
    if (!parsed || outside) {
      setInvalid(true);
      input?.setCustomValidity(t("dateField.invalid", { pattern }));
      return;
    }
    setInvalid(false);
    input?.setCustomValidity("");
    setText(null);
    commit(parsed);
  }

  const shown = text ?? (iso ? day(iso) : "");

  return (
    <span className="relative inline-flex w-full items-stretch">
      <input
        id={id ?? fallbackId}
        type="text"
        inputMode="text"
        autoComplete="off"
        value={shown}
        placeholder={pattern}
        required={required}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setText(event.target.value);
          if (invalid) event.target.setCustomValidity("");
        }}
        onBlur={(event) => text !== null && read(text, event.target)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && text !== null) read(text, event.currentTarget);
        }}
        className={`${className ?? ""} w-full pr-10 ${invalid ? "border-[var(--danger)]" : ""}`}
      />
      {name ? <input type="hidden" name={name} value={iso} /> : null}
      <button
        type="button"
        disabled={disabled}
        aria-label={t("dateField.calendar")}
        title={t("dateField.calendar")}
        onClick={() => {
          const input = picker.current;
          if (!input) return;
          try {
            input.showPicker();
          } catch {
            input.focus();
          }
        }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
        </svg>
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={iso}
        min={min}
        max={max}
        onChange={(event) => {
          setInvalid(false);
          setText(null);
          commit(event.target.value);
        }}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
      {invalid ? (
        <span role="alert" className="absolute left-0 top-full mt-0.5 text-xs text-[var(--danger)]">
          {t("dateField.invalid", { pattern })}
        </span>
      ) : null}
    </span>
  );
}
