import { en, type MessageKey } from "./en";

/**
 * The phrase for a key built at run time, such as a menu address or a status,
 * if the catalogue has one.
 *
 * Kept apart from `./index` so a component in the browser can use it without
 * taking every language's catalogue into the browser with it: the catalogues
 * stay on the server, and the page hands the browser only its reader's.
 */
export function maybe(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  key: string,
): string | null {
  return key in en ? t(key as MessageKey) : null;
}
