/**
 * What a page sends a browser of the reader's language. Job sheet D9.
 *
 * Until 1 October every page carried the whole language, about 70 KB
 * compressed, for the browser to use a little under half of it. Now it carries
 * what the browser's own code can ask for. The risk in that is a phrase the
 * browser needs and was not sent, which would show in English: so the list is
 * generated from the code, and this fails when it falls behind.
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CLIENT_OUTPUT, clientPhrases, renderClientKeys } from "../scripts/client-phrases";
import { catalogueFor, translator } from "@/lib/i18n";
import { CLIENT_KEYS } from "@/lib/i18n/client-keys";

describe("the phrases a browser can ask for", () => {
  it("are listed from the code as it is (npm run translations:client)", () => {
    const onDisk = readFileSync(CLIENT_OUTPUT, "utf8").replace(/\r\n/g, "\n");
    expect(onDisk).toBe(renderClientKeys(clientPhrases()));
  });

  it("include a key built from a template and one chosen by a condition", () => {
    // `session.kind.${kind}` in the schedule form; a ternary in the language form.
    expect(Object.keys(catalogueFor("zu")).some((key) => key.startsWith("session.kind."))).toBe(true);
    expect(CLIENT_KEYS).toContain("language.state.draft");
  });

  it("are all a page sends, translated, and far less than the whole language", () => {
    const sent = catalogueFor("zu");
    // "Saving…" is shown by forms as they submit, in the browser.
    expect(sent["common.saving"]).toBe(translator("zu")("common.saving"));
    expect(sent["common.saving"]).not.toBe("Saving…");
    // The frame and a server page's headings arrive already in the language.
    expect(sent["shell.signOut"]).toBeUndefined();
    expect(sent["personPage.awarded"]).toBeUndefined();
    expect(Object.keys(sent).length).toBeLessThan(2500);
    expect(gzipSync(JSON.stringify(JSON.stringify(sent))).length).toBeLessThan(50 * 1024);
  });

  it("send nothing for English, which the browser already holds", () => {
    expect(catalogueFor("en")).toEqual({});
  });
});
