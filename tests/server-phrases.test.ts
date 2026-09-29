/**
 * The messages the server writes, in the reader's language. Job sheet D9,
 * stage 5.
 *
 * Two halves. The catalogue has to hold every message lib/ and the server
 * actions can produce, or a new one reaches people in English with nothing
 * to say so. The lookup has to recognise a message that has values in it,
 * and one built from several, and leave anything it does not know exactly as
 * it was.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collect, KEPT_ENGLISH, OUTPUT, phrasesIn, renderCatalogue } from "../scripts/server-phrases";
import { server } from "@/lib/i18n/en-server";
import { buildIndex, sayer, sayWith, sayWithin } from "@/lib/i18n/said";

describe("the catalogue of server messages", () => {
  it("is up to date with the code (npm run translations:server)", () => {
    const onDisk = readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n");
    expect(onDisk).toBe(renderCatalogue(collect()));
  });

  it("says why each file it leaves out stays English", () => {
    for (const reason of Object.values(KEPT_ENGLISH)) expect(reason.length).toBeGreaterThan(20);
  });

  it("finds the kinds of message lib/ raises", () => {
    const found = phrasesIn(
      "lib/example.ts",
      [
        'throw new ExampleError("Person not found.");',
        "throw new ExampleError(`You have used all ${assessment.maxAttempts} attempts.`);",
        'return { error: "Your role does not allow that." };',
        'return { notice: "Saved." };',
        "const late = `This is ${days} working ${days === 1 ? \"day\" : \"days\"} late.`;",
        'z.string().min(1, "Give the template a name.");',
      ].join("\n"),
    ).map((phrase) => phrase.english);
    expect(found).toEqual([
      "Person not found.",
      "You have used all {maxAttempts} attempts.",
      "Your role does not allow that.",
      "Saved.",
      "This is {days} working day late.",
      "This is {days} working days late.",
      "Give the template a name.",
    ]);
  });

  it("leaves out what is not wording", () => {
    const found = phrasesIn(
      "lib/example.ts",
      [
        'import { x } from "Some Module Name";',
        'if (kind === "Not A Message") {}',
        'console.log("Something went wrong here");',
        'const tools = "Read,Write,Glob,Grep";',
        'await recordAudit(tx, { action: "organisation.language_changed" });',
        'const file = `EISA registration - ${name}.csv`;',
      ].join("\n"),
    );
    expect(found).toEqual([]);
  });

  it("holds no phrase a screen already has", async () => {
    const { en } = await import("@/lib/i18n/en");
    const screens = new Set<string>(Object.values(en));
    expect(Object.values(server).filter((english) => screens.has(english))).toEqual([]);
  });
});

describe("putting a message into the reader's language", () => {
  const english = {
    "said.a": "Person not found.",
    "said.b": "You have used all {maxAttempts} attempts at this assessment.",
    "said.c": "Not ready to publish. {reasons}",
    "said.d": "The course has no lessons yet.",
    "said.e": "That file was not accepted: {reason}",
    "said.f": "That file type is not recognised.",
  };
  const afrikaans = {
    "said.a": "Persoon nie gevind nie.",
    "said.b": "Jy het al {maxAttempts} pogings by hierdie assessering gebruik.",
    "said.c": "Nie gereed om te publiseer nie. {reasons}",
    "said.d": "Die kursus het nog geen lesse nie.",
    "said.e": "Daardie lêer is nie aanvaar nie: {reason}",
    "said.f": "Daardie lêertipe word nie herken nie.",
  };
  const say = sayWith(buildIndex(english), afrikaans);

  it("recognises a message by its English", () => {
    expect(say("Person not found.")).toBe("Persoon nie gevind nie.");
  });

  it("carries the values across", () => {
    expect(say("You have used all 3 attempts at this assessment.")).toBe(
      "Jy het al 3 pogings by hierdie assessering gebruik.",
    );
  });

  it("translates a value that is itself a message", () => {
    expect(say("Not ready to publish. The course has no lessons yet.")).toBe(
      "Nie gereed om te publiseer nie. Die kursus het nog geen lesse nie.",
    );
    expect(say("That file was not accepted: That file type is not recognised.")).toBe(
      "Daardie lêer is nie aanvaar nie: Daardie lêertipe word nie herken nie.",
    );
  });

  it("takes a message built from several a sentence at a time", () => {
    expect(say("Person not found. The course has no lessons yet.")).toBe(
      "Persoon nie gevind nie. Die kursus het nog geen lesse nie.",
    );
  });

  it("leaves what it does not know exactly as it was", () => {
    expect(say("Something nobody wrote down.")).toBe("Something nobody wrote down.");
    expect(say("Person not found. Something nobody wrote down.")).toBe(
      "Persoon nie gevind nie. Something nobody wrote down.",
    );
    expect(say("")).toBe("");
  });

  it("leaves a phrase with no translation in English", () => {
    const partial = sayWith(buildIndex(english), { "said.a": "Persoon nie gevind nie." });
    expect(partial("The course has no lessons yet.")).toBe("The course has no lessons yet.");
  });

  it("puts a result's messages into the language, at any depth, and nothing else", () => {
    const view = {
      title: "Person not found.",
      error: "Person not found.",
      rows: [{ name: "Sam", problems: ["The course has no lessons yet."], at: new Date(0) }],
      steps: [{ blockedBy: ["Person not found."], open: false }],
    };
    const out = sayWithin(view, say);
    expect(out.title).toBe("Person not found.");
    expect(out.error).toBe("Persoon nie gevind nie.");
    expect(out.rows[0].problems).toEqual(["Die kursus het nog geen lesse nie."]);
    expect(out.rows[0].name).toBe("Sam");
    expect(out.rows[0].at).toBeInstanceOf(Date);
    expect(out.steps[0]).toEqual({ blockedBy: ["Persoon nie gevind nie."], open: false });
    expect(view.error).toBe("Person not found.");
  });

  it("does not let a pattern that is nearly all values match anything", () => {
    const loose = sayWith(buildIndex({ "said.x": "{a} {b}", "said.y": "{made}Committed: {built}." }), {
      "said.x": "LOOSE",
      "said.y": "Vasgelê: {built}.",
    });
    expect(loose("Any two words")).toBe("Any two words");
    expect(loose("Committed: five modules.")).toBe("Vasgelê: five modules.");
  });

  it("passes English straight through", () => {
    expect(sayer("en")("Person not found.")).toBe("Person not found.");
    expect(sayer(null)("Person not found.")).toBe("Person not found.");
  });
});
