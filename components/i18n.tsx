"use client";

import { createContext, useContext, useMemo } from "react";
import { en, type MessageKey } from "@/lib/i18n/en";
import type { Translate } from "@/lib/i18n";
import { DEFAULT_DATE_STYLE, dateWriter, type DateStyle, type DateWriter } from "@/lib/date-format";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";

/**
 * The person's language, for components that run in the browser (job sheet
 * D9). The page frame and the sign-in page put the catalogue here once; a
 * component asks for `useT()` and gets the same phrases the server used.
 * Outside a provider it speaks English, so nothing breaks for want of one.
 */
const Messages = createContext<Record<string, string>>(en);
const Dates = createContext<string>("en-ZA");
const DateStyleContext = createContext<DateSettings | null>(null);

type DateSettings = { style: DateStyle; language: string; device: string | null; timeZone: string };

export function I18nProvider({
  messages,
  dates = "en-ZA",
  dateSettings,
  children,
}: {
  messages: Record<string, string>;
  /** The tag to write dates with (`dateLocale`), so a date reads as the words do. */
  dates?: string;
  /** The provider's date style (lib/request.ts pageDates), so the browser writes dates as the server does. */
  dateSettings?: DateSettings;
  children: React.ReactNode;
}) {
  return (
    <Messages.Provider value={messages}>
      <Dates.Provider value={dates}>
        <DateStyleContext.Provider value={dateSettings ?? null}>{children}</DateStyleContext.Provider>
      </Dates.Provider>
    </Messages.Provider>
  );
}

/** The reader's date format, for `toLocaleDateString` in the browser. */
export function useDates(): string {
  return useContext(Dates);
}

/** Dates written in the provider's chosen style (lib/date-format.ts). */
export function useDay(): DateWriter {
  const settings = useContext(DateStyleContext);
  const language = useContext(Dates);
  return useMemo(
    () =>
      dateWriter(
        settings?.style ?? DEFAULT_DATE_STYLE,
        settings?.language ?? language,
        settings?.device ?? null,
        settings?.timeZone ?? DEFAULT_TIME_ZONE,
      ),
    [settings, language],
  );
}

export function useT(): Translate {
  const messages = useContext(Messages);
  return useMemo<Translate>(
    () => (key: MessageKey, values?: Record<string, string | number>) => {
      const phrase = messages[key] ?? en[key] ?? key;
      return values
        ? phrase.replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all))
        : phrase;
    },
    [messages],
  );
}
