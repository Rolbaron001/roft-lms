/**
 * What a tenant's platform does, and what it must not quietly stop doing.
 *
 * Roland, 21 September 2026: "I need the system to be flexible per client."
 * Not every client is in South Africa, not every client wants accreditation,
 * and a corporate client may be accredited all the same, as the prospective
 * Ranger clients would be.
 *
 * The switches are easy. The dangerous part is the default, because this
 * shipped to a live tenant whose stored flags are empty. Reading a missing key
 * as "off" would have removed qualifications, study units and statutory
 * reporting from Curiosa on the deploy that carried it, with the data intact
 * and no screen left to reach it from. Most of what follows is about that.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  can,
  capabilitiesOf,
  flagsFrom,
} from "@/lib/features";
import { NAV } from "@/lib/navigation";

describe("a tenant that has never been configured", () => {
  it("keeps every capability", () => {
    // Curiosa's featureFlags on production is empty. This is the test that
    // says their platform does not change shape when this deploys.
    for (const key of CAPABILITY_KEYS) {
      expect(can({}, key)).toBe(true);
      expect(can(null, key)).toBe(true);
      expect(can(undefined, key)).toBe(true);
    }
  });

  it("keeps a capability the stored flags say nothing about", () => {
    /*
     * The forward looking half. A tenant configured today writes only what it
     * switched off, so a capability added next month is absent from their
     * record. Absent has to mean on, or every existing tenant loses each new
     * capability on the day it ships.
     */
    const configuredLastMonth = { programmes: false };
    expect(can(configuredLastMonth, "qualifications")).toBe(true);
    expect(can(configuredLastMonth, "workplace_experience")).toBe(true);
    expect(can(configuredLastMonth, "programmes")).toBe(false);
  });
});

describe("switching one off", () => {
  it("leaves the others alone", () => {
    // Roland's correction: a corporate client may be accredited. The switches
    // describe what a tenant does, so no two of them may be welded together.
    const corporate = capabilitiesOf({
      qualifications: false,
      study_units: false,
      statutory_reporting: false,
      workplace_experience: false,
    });

    expect(corporate.qualifications).toBe(false);
    expect(corporate.programmes).toBe(true);

    const accreditedCorporate = capabilitiesOf({ statutory_reporting: false });
    expect(accreditedCorporate.qualifications).toBe(true);
    expect(accreditedCorporate.workplace_experience).toBe(true);
    expect(accreditedCorporate.statutory_reporting).toBe(false);
  });

  it("stores only the exceptions", () => {
    const stored = flagsFrom({
      qualifications: true,
      study_units: true,
      programmes: false,
      statutory_reporting: false,
      workplace_experience: true,
    });

    // Not { qualifications: true, ... }. Writing the whole set would freeze
    // this tenant's record against the capabilities that existed today.
    expect(stored).toEqual({ programmes: false, statutory_reporting: false });
  });

  it("stores nothing for a tenant that wants everything", () => {
    const everything = Object.fromEntries(
      CAPABILITY_KEYS.map((key) => [key, true]),
    );
    expect(flagsFrom(everything)).toEqual({});
  });
});

describe("the menu honours the switches", () => {
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
    // A typo here would be silent: an unknown feature name would simply never
    // match, and the entry would show for everybody for ever.
    const known = new Set<string>([...CAPABILITY_KEYS, "offline"]);
    for (const item of items) {
      if (item.feature) expect(known.has(item.feature)).toBe(true);
    }
  });

  it("leaves the pages every tenant has ungated", () => {
    // Courses, People, Settings and the rest are not optional. Gating one by
    // accident would take it away from a tenant who never chose that.
    for (const href of ["/courses", "/people", "/settings", "/"]) {
      expect(itemFor(href).feature).toBeUndefined();
    }
  });
});

describe("the pages behind a switch refuse to load without it", () => {
  /*
   * Hiding a menu entry is not hiding a feature. Every one of these stays
   * reachable by typing the address, by an old bookmark, by a link in an email
   * sent before somebody switched the capability off.
   */
  function source(path: string): string {
    return readFileSync(join(process.cwd(), path), "utf8");
  }

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

describe("what a person setting this up is told", () => {
  it("says what each switch covers and when to turn it off", () => {
    /*
     * A switch with no stated reason gets left at whatever it came as, which
     * makes the whole feature decorative. The "off when" half is the one a
     * settings screen usually omits.
     */
    for (const key of CAPABILITY_KEYS) {
      expect(CAPABILITIES[key].label.length).toBeGreaterThan(3);
      expect(CAPABILITIES[key].covers.length).toBeGreaterThan(30);
      expect(CAPABILITIES[key].offWhen.length).toBeGreaterThan(30);
    }
  });

  it("has retired the words the 28 August paper retired", () => {
    // "Learning paths" survived in the tenant creation form, which was the one
    // place a new tenant still met the retired word.
    const form = readFileSync(
      join(process.cwd(), "app/platform/new-tenant-form.tsx"),
      "utf8",
    );
    expect(form).not.toMatch(/name="learning_paths"/);
    expect(form).not.toMatch(/<span>Learning paths<\/span>/);
    expect(CAPABILITIES.programmes.label).toBe("Programmes");
  });
});

/**
 * Seen to be applied, and changeable.
 *
 * Roland, 21 September: "The two settings don't appear in the LMS yet. So
 * please apply it, but in such a way that it is seen to be applied and can be
 * changed. Not hard-coded for Curiosa."
 *
 * The switches existed only on the form that creates a tenant, so a provider
 * already running could neither see what they had nor change any of it. A
 * setting nobody can see is indistinguishable from a setting that does not
 * work.
 */
describe("a running tenant can see and change its own switches", () => {
  function source(path: string): string {
    return readFileSync(join(process.cwd(), path), "utf8");
  }

  it("has a settings section built from the capability list", () => {
    const form = source("app/settings/capabilities-form.tsx");
    // Built from the list rather than written out, so a sixth capability
    // appears here without anybody editing this file.
    expect(form).toMatch(/CAPABILITY_KEYS\.map/);
    expect(source("app/settings/page.tsx")).toMatch(/<CapabilitiesForm/);
  });

  it("reads every switch from the known list, not from the post", () => {
    /*
     * An unchecked box posts nothing at all. Reading the form's keys would
     * make "switched off" and "not sent" the same thing, which is fine here
     * and wrong the moment a browser sends a partial form.
     */
    const action = source("app/settings/capabilities-actions.ts");
    expect(action).toMatch(/CAPABILITY_KEYS\.map/);
    expect(action).toMatch(/requirePermission\("tenant:manage_settings"\)/);
  });

  it("says that switching one off deletes nothing", () => {
    // The sentence that makes this safe to try. Without it the honest reading
    // of an unchecked box is that the records went with it.
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
    // The tenant record is cached. Saving without clearing it leaves the menu
    // exactly as it was, which reads as the setting having failed.
    const lib = source("lib/provisioning.ts");
    const at = lib.indexOf("setTenantCapabilities");
    expect(lib.slice(at)).toMatch(/clearTenantCache\(\)/);
  });
});
