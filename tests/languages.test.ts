/**
 * The platform in more than one language. Job sheet D9, 27 September 2026.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { af } from "@/lib/i18n/af";
import { en } from "@/lib/i18n/en";
import { catalogueFor, translator } from "@/lib/i18n";
import { LOCALES, dateLocale, localeFor, localeOf } from "@/lib/i18n/locales";
import { vocabulary } from "@/lib/terms";

describe("the languages offered", () => {
  it("are the sixteen Roland chose: English, the ten other written official languages, and five European", () => {
    expect(LOCALES.map((l) => l.code)).toEqual([
      "en", "af", "zu", "xh", "nr", "nso", "st", "tn", "ss", "ve", "ts", "es", "fr", "it", "de", "pt",
    ]);
  });

  it("say honestly how far each has got", () => {
    expect(localeOf("en").state).toBe("complete");
    expect(localeOf("af").state).toBe("draft");
    expect(localeOf("zu").state).toBe("planned");
  });
});

describe("putting a phrase into a language", () => {
  it("translates, fills in values, and falls back to English phrase by phrase", () => {
    const t = translator("af");
    expect(t("shell.signOut")).toBe("Teken uit");
    expect(t("learn.lessonsDone", { done: 2, total: 5 })).toBe("2 van 5 klaar");
    // isiZulu is planned, not started: English, never a blank or a key.
    expect(translator("zu")("shell.signOut")).toBe("Sign out");
    expect(translator("xx")("shell.signOut")).toBe("Sign out");
  });

  it("keeps the regulator's names as the regulator writes them", () => {
    expect(translator("af")("nav./fisa")).toBe("FISA");
    expect(translator("af")("nav./readiness")).toContain("EISA");
  });

  it("has no Afrikaans phrase that is not in English, and none that breaks house style", () => {
    for (const key of Object.keys(af)) expect(key in en).toBe(true);
    for (const phrase of [...Object.values(en), ...Object.values(af)]) {
      expect(phrase).not.toMatch(/—/);
    }
    // Only a language's own phrases go to the browser; it has the English.
    expect(catalogueFor("en")).toEqual({});
    expect(catalogueFor("af")["shell.signOut"]).toBe("Teken uit");
    expect(Object.keys(catalogueFor("af")).length).toBeLessThanOrEqual(Object.keys(en).length);
  });

  it("keeps every value marker of the English in the Afrikaans", () => {
    for (const [key, phrase] of Object.entries(af)) {
      const wanted = (en[key as keyof typeof en].match(/\{\w+\}/g) ?? []).sort();
      expect((phrase!.match(/\{\w+\}/g) ?? []).sort(), key).toEqual(wanted);
    }
  });
});

describe("whose language", () => {
  it("is the person's own, else their provider's, else English", () => {
    expect(localeFor({ defaultLocale: "af" }, { locale: null })).toBe("af");
    expect(localeFor({ defaultLocale: "af" }, { locale: "en" })).toBe("en");
    expect(localeFor(null, null)).toBe("en");
    expect(localeFor({ defaultLocale: "nonsense" }, null)).toBe("en");
  });
});

describe("a provider's own words", () => {
  it("are translated where the provider kept the default, and kept exactly where they renamed", () => {
    expect(vocabulary(null, null, "af").many("course")).toBe("Kursusse");
    expect(vocabulary(null, { delivery: "study_units" }, "af").many("course")).toBe("Studie-eenhede");
    expect(vocabulary({ course: { one: "Module", many: "Modules" } }, null, "af").many("course")).toBe("Modules");
    expect(vocabulary(null).many("course")).toBe("Courses");
  });
});

describe("stage 2: the rest of what a learner sees", () => {
  const screens = [
    "app/learn/[id]/assessment/[assessmentId]/page.tsx",
    "app/learn/[id]/assessment/[assessmentId]/quiz-form.tsx",
    "app/learn/[id]/assessment/[assessmentId]/evidence-form.tsx",
    "app/learn/[id]/paper/[assessmentId]/page.tsx",
    "app/learn/[id]/paper/[assessmentId]/paper-form.tsx",
    "app/notifications/page.tsx",
    "app/notifications/mark-all-read.tsx",
    "app/certificates/[id]/page.tsx",
    "app/workplace/page.tsx",
    "app/workplace/[id]/page.tsx",
    "app/workplace/[id]/logbook-panel.tsx",
  ];
  const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("has an Afrikaans draft of every phrase on a learner's screens", () => {
    // Staff screens (stage 4) go through the numbered translation document,
    // Afrikaans included, rather than a hand-written draft (Roland, 27 September).
    const learner = /^(shell|nav|term|login|account|language|learn|role|status|home|assess|evidence|paper|notify|cert|work|scorm)\./;
    const missing = Object.keys(en).filter((key) => learner.test(key) && !(key in af));
    expect(missing).toEqual([]);
  });

  it("takes its wording from the catalogue on every screen", () => {
    // A phrase from each screen that used to be written into it.
    const once = [
      "Submit answers", "Evidence submitted", "Hand in", "Mark all as read",
      "Certificate of Completion", "Waiting for the coach", "Sign this logbook", "Your last attempt",
    ];
    for (const path of screens) {
      const text = source(path);
      expect(text, path).toMatch(/useT\(\)|translator\(/);
      for (const phrase of once) expect(text, `${path}: ${phrase}`).not.toContain(`>${phrase}<`);
      expect(text, path).not.toMatch(/toLocale(?:Date|Time)?String\("en-ZA"/);
    }
  });

  it("writes dates the way the reader's language does, and never in a form the runtime cannot", () => {
    expect(dateLocale("af")).toMatch(/^af/);
    expect(dateLocale("en")).toBe("en-ZA");
    expect(dateLocale("nonsense")).toBe("en-ZA");
    for (const locale of LOCALES) {
      expect(() => new Date(2026, 9, 1).toLocaleDateString(dateLocale(locale.code))).not.toThrow();
    }
    expect(new Date(2026, 9, 1).toLocaleDateString(dateLocale("af"), { month: "long" })).toBe("Oktober");
  });

  it("puts a certificate in its holder's language, whoever prints it", () => {
    const page = source("app/certificates/[id]/page.tsx");
    expect(page).toMatch(/localeFor\(tenant, holder\)/);
    expect(page).toMatch(/doc\("cert\.title"\)/);
    expect(translator("af")("cert.title")).toBe("Sertifikaat van Voltooiing");
  });

  it("leaves the declaration a learner signs in the words the provider or the platform wrote", () => {
    // A signed statement is not machine-translated: the draft could say
    // something the learner never agreed to. It is translated when a
    // translator has checked it (job sheet D9).
    expect(Object.keys(en).some((key) => /declarationText|declaration\.default/.test(key))).toBe(false);
  });
});

describe("where a person chooses", () => {
  it("is their account page, and the provider's default is in Settings", () => {
    const account = readFileSync(join(process.cwd(), "app/account/password/page.tsx"), "utf8");
    expect(account).toMatch(/<LanguageForm/);
    const settings = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
    expect(settings).toMatch(/<ProviderLanguageForm/);
    const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/lang=\{await currentLocale\(\)\}/);
  });
});
