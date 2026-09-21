/**
 * Reading one module written three different ways.
 *
 * Roland, 21 September, after every module of a fifteen-module qualification
 * failed to link: "The codes differ in the documents. Not an importer fault.
 * But it would be good if the system could read permutations of the codes to
 * avoid such issues. This type of fault is going to be continuous."
 *
 * The danger in a feature like this is not that it matches too little. It is
 * that it matches too much: a knowledge module quietly accepted as a workplace
 * module links a learner's evidence to the wrong half of a curriculum, and
 * nothing on any screen would look wrong. So most of what follows is about
 * what must NOT match.
 */
import { describe, expect, it } from "vitest";
import {
  aliasTable,
  aliasesFrom,
  moduleCodeCore,
  normaliseCode,
  permutationsFor,
  resolveCode,
  splitCode,
  standardsFrom,
} from "@/lib/module-codes";

describe("reducing a code to what matters", () => {
  it("removes punctuation, spacing and case", () => {
    // These were already treated as one code before any of this existed, and
    // that is why none of them appear as permutations: they are the same
    // string once normalised, and listing them would pad the table with rows
    // that do nothing.
    for (const written of ["KM01", "KM-01", "KM 01", "km.01", "K_M01", " KM01 "]) {
      expect(normaliseCode(written)).toBe("KM01");
    }
  });

  it("splits letters from the number", () => {
    expect(splitCode("KM-01")).toEqual({
      prefix: "KM",
      digits: "01",
      number: 1,
    });
  });

  it("returns nothing for a code it cannot read", () => {
    // A code with no number, or letters after the digits, is left alone rather
    // than guessed at.
    expect(splitCode("MODULE")).toBeNull();
    expect(splitCode("KM01A")).toBeNull();
    expect(permutationsFor("MODULE")).toEqual([]);
  });
});

describe("the permutations of one code", () => {
  const found = permutationsFor("KM01");

  it("covers a dropped and an added leading zero", () => {
    // The real failure. A curriculum numbering to fifteen writes two digits; a
    // summary table written by hand writes one.
    expect(found).toContain("KM1");
    expect(found).toContain("KM001");
  });

  it("covers a shortened prefix", () => {
    expect(found).toContain("K01");
    expect(found).toContain("K1");
  });

  it("never proposes dropping the first letter", () => {
    /*
     * The one that would be actively dangerous. M01 reads KM01, PM01 and WM01
     * equally well, and a knowledge module silently matched to a workplace
     * module puts a learner's evidence against the wrong half of the
     * curriculum with nothing on any screen looking wrong.
     *
     * Not merely removed later as ambiguous - never proposed, so it cannot
     * survive a set where only one component happens to be present.
     */
    expect(found).not.toContain("M01");
    expect(found).not.toContain("M1");
    expect(permutationsFor("KM01")).toEqual(
      permutationsFor("KM01").filter((alias) => alias.startsWith("K")),
    );
  });

  it("does not propose the code itself", () => {
    expect(found).not.toContain("KM01");
  });
});

describe("the table for a whole curriculum", () => {
  // 121151 as it really is: three components, five modules each.
  const codes = [
    "KM01", "KM02", "KM03", "KM04", "KM05",
    "PM01", "PM02", "PM03", "PM04", "PM05",
    "WM01", "WM02", "WM03", "WM04", "WM05",
  ];
  const rows = aliasTable(codes);

  it("has a row for every module", () => {
    expect(rows).toHaveLength(15);
    expect(rows.map((row) => row.canonical)).toEqual(codes);
  });

  it("keeps the digit-width readings, which are unambiguous here", () => {
    const km01 = rows.find((row) => row.canonical === "KM01");
    expect(km01?.aliases).toContain("KM1");
    expect(km01?.aliases).toContain("KM001");
  });

  it("drops a short form two components would both claim", () => {
    /*
     * K01 from KM01 is a fair reading on its own. But this curriculum also
     * has PM01 and WM01, and the moment the short forms of two modules could
     * collide the reading stops being a reading and becomes a guess.
     *
     * Here K01, P01 and W01 are each claimed by one component only, so they
     * survive - what must not survive is any alias claimed by two. Asserted as
     * a property over the whole table rather than by naming cases, because the
     * cases change with the curriculum and the property does not.
     */
    const everyAlias = rows.flatMap((row) => row.aliases);
    expect(new Set(everyAlias).size).toBe(everyAlias.length);
  });

  it("never lets an alias shadow a real module code", () => {
    const canonicals = new Set(rows.map((row) => row.canonical));
    for (const row of rows) {
      for (const alias of row.aliases) {
        expect(canonicals.has(alias)).toBe(false);
      }
    }
  });

  it("says what it withheld and why, rather than discarding it quietly", () => {
    // Somebody looking at the table should see that a spelling was considered
    // and why it is absent. Otherwise the first thing they do is add it back
    // by hand, which is the one edit that would break matching.
    const clashing = aliasTable(["KM1", "KM01"]);
    const reasons = clashing.flatMap((row) =>
      row.rejected.map((one) => one.because),
    );
    expect(reasons.join(" ")).toMatch(/module in its own right/);
  });

  it("refuses to abbreviate two modules to the same thing", () => {
    // A curriculum holding both KM01 and K01: neither may borrow the other's
    // spelling, in either direction.
    const rows = aliasTable(["KM01", "K01"]);
    for (const row of rows) {
      expect(row.aliases).not.toContain("KM01");
      expect(row.aliases).not.toContain("K01");
    }
  });
});

describe("resolving a code from a document", () => {
  const known = ["KM01", "PM01", "WM01"];
  const aliases = aliasesFrom(aliasTable(known));

  it("takes an exact match first, always", () => {
    expect(resolveCode("KM01", known, aliases)).toBe("KM01");
    // And through punctuation, which was true before any of this.
    expect(resolveCode("KM-01", known, aliases)).toBe("KM01");
  });

  it("reads a short or unpadded spelling", () => {
    expect(resolveCode("KM1", known, aliases)).toBe("KM01");
    expect(resolveCode("K01", known, aliases)).toBe("KM01");
  });

  it("cannot be shadowed by a careless alias", () => {
    /*
     * A tenant may edit this table, which means a tenant may put a real module
     * code into another module's alias list. The exact match is checked first
     * and unconditionally, so the real module still wins: the worst a bad edit
     * can do is fail to help, never redirect.
     */
    const careless = { PM01: ["KM01"] };
    expect(resolveCode("KM01", known, careless)).toBe("KM01");
  });

  it("ignores aliases for modules this qualification does not have", () => {
    // The table is the tenant's and spans every qualification they run. An
    // alias pointing at a module that is not in this curriculum must not
    // resolve to it.
    expect(resolveCode("KM1", ["PM01"], aliases)).toBeNull();
  });

  it("returns nothing rather than guessing", () => {
    expect(resolveCode("ZZ99", known, aliases)).toBeNull();
    expect(resolveCode("", known, aliases)).toBeNull();
  });
});

/**
 * Every spelling Curiosa's own documents actually use.
 *
 * Roland, 21 September: "Read through the documents ... and ensure that all
 * the various permutations can be accounted for (at least for Curiosa in this
 * test)."
 *
 * So they were read - all 81 files of the 121151 folder, every .docx and .pdf,
 * scanned for anything shaped like a module code. This is the result, and it
 * is the list the generator has to cover. None of it was reasoned about: a
 * hyphen here and a missing zero there is not something anybody would predict,
 * and the whole point of the feature is that the documents disagree in ways
 * nobody planned.
 *
 *   KM-01 … KM-05   hyphenated, the dominant form         (107 occurrences)
 *   KM03, PM03      the same modules unhyphenated          (12)
 *   WM01 … WM05     unhyphenated throughout                (33)
 *   KM1, PM1        no leading zero                         (8)
 *   WM 1 … WM 5     spaced AND unpadded                     (5)
 *
 * Two mechanisms cover all five. Punctuation and spacing are removed before
 * anything is compared, which collapses the first, second, third and the
 * spacing half of the fifth. The leading zero is what the generated table is
 * for.
 */
describe("the spellings Curiosa's documents really use", () => {
  const curriculum = [
    "KM01", "KM02", "KM03", "KM04", "KM05",
    "PM01", "PM02", "PM03", "PM04", "PM05",
    "WM01", "WM02", "WM03", "WM04", "WM05",
  ];
  const aliases = aliasesFrom(aliasTable(curriculum));

  // As they appear in the files, with what each one means.
  const asWritten: [string, string][] = [
    ["KM-01", "KM01"], ["KM-05", "KM05"],
    ["KM03", "KM03"],
    ["PM-01", "PM01"], ["PM03", "PM03"],
    ["WM-02", "WM02"], ["WM05", "WM05"],
    ["KM1", "KM01"], ["PM1", "PM01"],
    ["WM 1", "WM01"], ["WM 5", "WM05"],
  ];

  it.each(asWritten)("reads %s as %s", (written, meant) => {
    expect(resolveCode(written, curriculum, aliases)).toBe(meant);
  });

  it("covers every one of them, which is the claim being made", () => {
    // Asserted as a whole as well as case by case: a single unresolved
    // spelling is one module that will not link, and a module that does not
    // link is a module nobody teaches.
    const unresolved = asWritten.filter(
      ([written]) => resolveCode(written, curriculum, aliases) === null,
    );
    expect(unresolved).toEqual([]);
  });

  /**
   * The single-letter forms, which these documents never use.
   *
   * K01 and P1 are generated, because another provider may well write them.
   * Curiosa do not, and their documents contain page references - "p 608",
   * "p 30" - that a single letter and a number would read as a module code if
   * anything ever scanned free text with this table.
   *
   * Nothing does today: module codes reach the resolver from structured
   * positions in the alignment document, never from prose. This is pinned so
   * that if that ever changes, it changes deliberately. The spellings are
   * removable in the Settings modal, one click each.
   */
  it("also proposes single-letter forms, which Curiosa can remove", () => {
    expect(aliases.KM01).toContain("K1");
    expect(resolveCode("K1", curriculum, aliases)).toBe("KM01");
  });
});

/**
 * The QCTO's two names for the same module.
 *
 * This is the fault that started all of it, and it took a screenshot to see.
 * Curiosa's curriculum document numbers knowledge module one
 * `242303-001-00-KM-01` - the qualification's curriculum code with the module
 * code on the end - and their alignment document numbers the same module
 * `KM-01`. Both are the published convention for the document they appear in.
 * Neither is a mistake, and the curriculum was loaded correctly.
 *
 * All fifteen modules failed to link because `24230300100KM01` and `KM01` are
 * not the same string, and no table of permutations could have fixed it: the
 * curriculum code is different for every qualification, so the variations
 * would have to be regenerated per qualification and would never be a
 * *standard* at all.
 *
 * It is a rule instead. The code is the last run of letters followed by
 * digits.
 */
describe("a module code inside a full QCTO identifier", () => {
  it("is the last letters-and-digits run", () => {
    expect(moduleCodeCore("242303-001-00-KM-01")).toBe("KM01");
    expect(moduleCodeCore("24230300100KM01")).toBe("KM01");
    expect(moduleCodeCore("KM-01")).toBe("KM01");
    expect(moduleCodeCore("KM1")).toBe("KM1");
  });

  it("is nothing where there is no code to find", () => {
    // A bare curriculum code is not a module. Returning "00" from
    // "242303-001-00-00" would match a module numbered zero.
    expect(moduleCodeCore("242303-001-00-00")).toBeNull();
    expect(moduleCodeCore("")).toBeNull();
    expect(moduleCodeCore("Module")).toBeNull();
  });

  it("links the long form to the short one, with no table at all", () => {
    /*
     * The actual repair. An empty alias table, a curriculum holding the full
     * identifiers, an alignment document naming the short codes - and they
     * match. Nothing has to be renamed and nothing has to be confirmed in
     * Settings first.
     */
    const curriculum = [
      "242303-001-00-KM-01",
      "242303-001-00-PM-01",
      "242303-001-00-WM-01",
    ];

    expect(resolveCode("KM-01", curriculum, {})).toBe("24230300100KM01");
    expect(resolveCode("PM01", curriculum, {})).toBe("24230300100PM01");
    expect(resolveCode("WM 1", curriculum, {})).toBeNull();
  });

  it("reads the short form's variations once the table is confirmed", () => {
    // WM 1 above is unpadded, so it needs the table - which is exactly the
    // division of labour: the rule crosses the identifier, the table crosses
    // the spelling.
    const curriculum = [
      "242303-001-00-KM-01",
      "242303-001-00-PM-01",
      "242303-001-00-WM-01",
    ];
    const aliases = aliasesFrom(aliasTable(standardsFrom(curriculum)));

    expect(resolveCode("WM 1", curriculum, aliases)).toBe("24230300100WM01");
    expect(resolveCode("KM1", curriculum, aliases)).toBe("24230300100KM01");
  });

  it("infers the standards from what is loaded, not the stored strings", () => {
    /*
     * Roland, 21 September, on being shown fifteen rows of
     * "Only 24230300100KM04 itself": "The codes are straight forward ...
     * KM1=KM01=K1=KM-01=KM-1. These are the codes that the system must look
     * for." The table's rows are the module codes, never the identifiers they
     * happen to be stored under.
     */
    const standards = standardsFrom([
      "242303-001-00-KM-01",
      "242303-001-00-KM-02",
      "KM-03",
    ]);

    expect(standards).toEqual(["KM01", "KM02", "KM03"]);
    expect(aliasTable(standards)[0].aliases).toContain("KM1");
  });

  it("refuses to choose when two modules share a core", () => {
    // Two qualifications' modules in one list, both ending KM01. Picking the
    // first would link a learner's evidence to whichever happened to sort
    // earlier, and nothing on any screen would look wrong.
    const ambiguous = ["242303-001-00-KM-01", "118709-001-00-KM-01"];
    expect(resolveCode("KM-01", ambiguous, {})).toBeNull();
  });
});
