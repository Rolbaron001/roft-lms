/**
 * The shape of a tenant's platform, and what it must not quietly stop doing.
 *
 * Roland, 21 September 2026: "I need the system to be flexible per client."
 * Not every client is in South Africa, not every client seeks accreditation,
 * and a corporate client may be accredited all the same, as the prospective
 * Ranger clients would be.
 *
 * This began as five independent switches and Roland corrected it the same
 * afternoon: "We have already determined that Course and Study Unit are the
 * same thing in terms of where they rank. What the selection needs to do is to
 * determine how the users view them." Independent switches let somebody
 * produce a platform that cannot exist. Two questions with one answer each
 * cannot.
 *
 * The dangerous part is still the default, because this ships to a live tenant
 * whose stored record is empty. Reading absence as "off" would have removed
 * qualifications and statutory reporting from Curiosa on the deploy that
 * carried it, with the data intact and no screen left to reach it from.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AWARD_CHOICES,
  CAPABILITY_KEYS,
  DELIVERY_CHOICES,
  DEFAULT_STRUCTURE,
  can,
  capabilitiesOf,
  deliveryAvailable,
  platformShape,
  settledTerms,
  structureFrom,
  structureOf,
} from "@/lib/features";
import { NAV } from "@/lib/navigation";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("a tenant that has never been configured", () => {
  it("keeps the platform it has today", () => {
    // Curiosa's record on production is empty. This is the test that says
    // their platform does not change shape when this deploys.
    for (const stored of [null, undefined, {}]) {
      expect(structureOf(stored)).toEqual(DEFAULT_STRUCTURE);
      for (const key of CAPABILITY_KEYS) {
        if (key === "study_units") continue;
        expect(can(stored, key)).toBe(true);
      }
    }
  });

  it("defaults to the two layers being separate", () => {
    // Today every tenant sees Qualifications and Programmes as two menu
    // entries. The default has to be that, not the shape we expect Curiosa to
    // choose, or choosing for them happens on deploy rather than on purpose.
    expect(DEFAULT_STRUCTURE.award).toBe("qualification_and_programme");
    expect(DEFAULT_STRUCTURE.delivery).toBe("courses");
  });

  it("keeps a switch the stored record says nothing about", () => {
    const partial = { award: "qualification_programme" as const };
    expect(can(partial, "statutory_reporting")).toBe(true);
    expect(can(partial, "workplace_experience")).toBe(true);
  });
});

describe("what sits at the top", () => {
  it("gives Curiosa one thing rather than two", () => {
    /*
     * Heidi: "we have programmes, not courses ... at this stage a
     * qualification is a programme." Under the combined award there is still a
     * qualification, and there is no separate Programmes screen, because it
     * would list the same objects again under another name.
     */
    const curiosa = capabilitiesOf({ award: "qualification_programme" });
    expect(curiosa.qualifications).toBe(true);
    expect(curiosa.programmes).toBe(false);
  });

  it("gives both to a provider who bundles as well", () => {
    const both = capabilitiesOf({ award: "qualification_and_programme" });
    expect(both.qualifications).toBe(true);
    expect(both.programmes).toBe(true);
  });

  it("gives a corporate client programmes without accreditation", () => {
    // Roland's correction stays true: accreditation is independent of what
    // kind of organisation this is. A corporate may be accredited, and this
    // one is not.
    const corporate = capabilitiesOf({ award: "programmes_only" });
    expect(corporate.qualifications).toBe(false);
    expect(corporate.programmes).toBe(true);
  });

  it("gives a provider with neither exactly that", () => {
    const alone = capabilitiesOf({ award: "standalone" });
    expect(alone.qualifications).toBe(false);
    expect(alone.programmes).toBe(false);
  });
});

describe("what a learner works through", () => {
  it("is one or the other, never both", () => {
    // Roland: "Selecting one of the 2 makes the other un-selectable."
    expect(can({ delivery: "study_units" }, "study_units")).toBe(true);
    expect(can({ delivery: "courses" }, "study_units")).toBe(false);
  });

  it("cannot be study units with nothing for them to sit in", () => {
    /*
     * A study unit is a grouping inside a qualification. A provider with no
     * qualification has nothing for one to live in, so this combination is not
     * merely refused at the form; it is corrected on the way back out, which
     * also covers a record edited by hand.
     */
    expect(deliveryAvailable("programmes_only", "study_units")).toBe(false);
    expect(deliveryAvailable("standalone", "study_units")).toBe(false);
    expect(deliveryAvailable("qualification_programme", "study_units")).toBe(
      true,
    );

    const impossible = structureOf({
      award: "standalone",
      delivery: "study_units",
    });
    expect(impossible.delivery).toBe("courses");
  });

  it("survives a form posting nonsense", () => {
    const posted = structureFrom({ award: "nonsense", delivery: "rubbish" });
    expect(posted).toEqual(DEFAULT_STRUCTURE);
  });
});

describe("what the choices are called on screen", () => {
  it("never tells a provider the regulator requires either word", () => {
    /*
     * Counted on 21 September in the project's own documents: "study unit"
     * appears zero times in the 121151 curriculum, its qualification document,
     * its assessment specification, the 118709 curriculum and SAQA's
     * NQFpedia. "Course" appears zero times in the four QCTO documents.
     *
     * Roland asked to be checked on exactly this. These words go onto screens
     * that accredited providers read, so the platform offers them as a
     * provider's own vocabulary and claims nothing about the regulator.
     */
    const shown = [...AWARD_CHOICES, ...DELIVERY_CHOICES]
      .flatMap((choice) => [choice.label, choice.covers, choice.chooseWhen])
      .join(" ");

    expect(shown).not.toMatch(/QCTO/);
    expect(shown).not.toMatch(/SAQA/);
  });

  it("says who each choice is for, not only what it does", () => {
    for (const choice of [...AWARD_CHOICES, ...DELIVERY_CHOICES]) {
      expect(choice.covers.length).toBeGreaterThan(40);
      expect(choice.chooseWhen.length).toBeGreaterThan(30);
    }
  });
});

describe("what the choices settle about vocabulary", () => {
  it("stops offering to rename the word the choice already set", () => {
    // Roland: "pointless displaying courses if the user has already selected
    // Courses/Study Units."
    expect(settledTerms({ delivery: "study_units" })).toContain("course");
    expect(settledTerms({ delivery: "courses" })).toContain("studyUnit");
  });

  it("stops offering to rename a programme that is the qualification", () => {
    expect(settledTerms({ award: "qualification_programme" })).toContain(
      "programme",
    );
    expect(
      settledTerms({ award: "qualification_and_programme" }),
    ).not.toContain("programme");
  });
});

describe("what the choices add up to", () => {
  it("says the qualification is the programme when they are one", () => {
    const curiosa = platformShape({
      award: "qualification_programme",
      delivery: "study_units",
    });

    expect(curiosa.map((layer) => layer.name)).toEqual([
      "Qualification / Programme",
      "Study unit",
    ]);
    expect(curiosa[0].note).toMatch(/one thing/i);
  });

  it("shows them apart when they are apart", () => {
    expect(
      platformShape({ award: "qualification_and_programme" }).map(
        (layer) => layer.name,
      ),
    ).toEqual(["Qualification", "Programme", "Course"]);
  });

  it("always ends at the thing a learner works through", () => {
    // Whatever is chosen, something has to be the thing somebody is enrolled
    // onto. A shape ending at "Qualification" would describe a platform that
    // accredits and never teaches.
    for (const choice of AWARD_CHOICES) {
      const shape = platformShape({ award: choice.value });
      expect(["Course", "Study unit"]).toContain(shape.at(-1)?.name);
    }
  });

  it("is derived rather than written beside the choices", () => {
    expect(source("app/settings/capabilities-form.tsx")).toMatch(/shape\.map/);
  });
});

describe("the menu honours the shape", () => {
  const items = NAV.flatMap((section) => section.items);

  function itemFor(href: string) {
    const found = items.find((item) => item.href === href);
    expect(found, `no nav item for ${href}`).toBeDefined();
    return found!;
  }

  it.each([
    ["/qualifications", "qualifications"],
    ["/eisa", "qualifications"],
    ["/readiness", "qualifications"],
    ["/paths", "programmes"],
    ["/statutory", "statutory_reporting"],
    ["/statutory/notify", "statutory_reporting"],
    ["/workplace", "workplace_experience"],
  ])("%s is behind %s", (href, capability) => {
    expect(itemFor(href).feature).toBe(capability);
  });

  it("names only capabilities that exist", () => {
    // A typo would be silent: an unknown name never matches, so the entry
    // would show for everybody for ever.
    const known = new Set<string>([...CAPABILITY_KEYS, "offline"]);
    for (const item of items) {
      if (item.feature) expect(known.has(item.feature)).toBe(true);
    }
  });

  it("leaves the pages every tenant has ungated", () => {
    for (const href of ["/courses", "/people", "/settings", "/"]) {
      expect(itemFor(href).feature).toBeUndefined();
    }
  });
});

describe("the pages behind a choice refuse to load without it", () => {
  /*
   * Hiding a menu entry is not hiding a feature. Every one of these stays
   * reachable by typing the address, by an old bookmark, by a link in an email
   * sent before somebody changed the shape.
   */
  it.each([
    ["app/qualifications/page.tsx", "qualifications"],
    ["app/qualifications/[id]/page.tsx", "qualifications"],
    ["app/paths/page.tsx", "programmes"],
    ["app/statutory/page.tsx", "statutory_reporting"],
    ["app/statutory/notify/page.tsx", "statutory_reporting"],
    ["app/workplace/page.tsx", "workplace_experience"],
    ["app/eisa/page.tsx", "qualifications"],
    ["app/readiness/page.tsx", "qualifications"],
  ])("%s requires %s", (path, capability) => {
    expect(source(path)).toContain(`requireCapability("${capability}")`);
  });
});

describe("a running tenant can see and change its own shape", () => {
  it("has a settings section, not only a creation form", () => {
    // Roland: "The two settings don't appear in the LMS yet." A setting
    // nobody can see is indistinguishable from one that does not work.
    expect(source("app/settings/page.tsx")).toMatch(/<CapabilitiesForm/);
  });

  it("says that changing it deletes nothing", () => {
    expect(source("app/settings/capabilities-form.tsx")).toMatch(
      /Nothing is deleted/i,
    );
  });

  it("is audited, because it changes what the platform is", () => {
    expect(source("lib/provisioning.ts")).toMatch(
      /action: "tenant\.capabilities_updated"/,
    );
  });

  it("clears the cached tenant, or the menu would not move", () => {
    const lib = source("lib/provisioning.ts");
    expect(lib.slice(lib.indexOf("setTenantCapabilities"))).toMatch(
      /clearTenantCache\(\)/,
    );
  });

  it("has retired the words the 28 August paper retired", () => {
    const form = source("app/platform/new-tenant-form.tsx");
    expect(form).not.toMatch(/name="learning_paths"/);
    expect(form).not.toMatch(/<span>Learning paths<\/span>/);
  });
});
