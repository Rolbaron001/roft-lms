/**
 * What a tenant's platform actually does.
 *
 * Roland, 21 September 2026: "I'm trying to think for different clients, not
 * all of whom will be located in South Africa and some even when in South
 * Africa won't care about accrediting a qualification, but will want a course
 * to present to employees. I need the system to be flexible per client."
 *
 * The switch is about what a tenant does, never about what kind of
 * organisation it is. Roland's own correction made the point: a corporate
 * client may be accredited to offer a qualification, as the prospective Ranger
 * clients would be. "Corporate" and "accredited" are independent facts, so
 * tying one capability to the other would be wrong the first time it was used.
 *
 * Three things were needed to make this work and only one was missing.
 * Terminology already exists per tenant, with a settings screen. Navigation
 * already exists per tenant, with an editor. Feature flags existed as a form
 * and a database column and were **read by nothing**: a tenant created with
 * learning paths switched off still saw the Programmes menu. This module is
 * the missing reader.
 *
 * The structure does not change. Roland's working paper of 28 August checked
 * the Qualification / Programme / Course model against SAQA, DHET, the QCTO,
 * Ofqual, the US CEDS standard, Moodle Workplace, Coursera and edX, and none
 * of the seven collapses the atomic teaching unit into the bundle above it.
 * What changes is what each tenant sees and what each tenant calls it.
 *
 * This module imports nothing, so a form can use it.
 */

export type Capability =
  | "qualifications"
  | "study_units"
  | "programmes"
  | "statutory_reporting"
  | "workplace_experience";

export type CapabilityShape = {
  label: string;
  /** What switching it off takes away, in the words a provider would use. */
  covers: string;
  /**
   * Why a provider might not want it, which is the half a settings screen
   * usually leaves out. A switch with no stated reason gets left at whatever
   * it came as.
   */
  offWhen: string;
};

export const CAPABILITIES: Record<Capability, CapabilityShape> = {
  qualifications: {
    label: "Accredited qualifications",
    covers:
      "Qualifications, their curriculum and assessment criteria, EISA readiness, statements of results and certificates.",
    offWhen:
      "This provider delivers training that answers to no qualification: induction, compliance refreshers, internal skills courses.",
  },
  study_units: {
    label: "Study units",
    covers:
      "The grouping between a qualification and its material, bundling the knowledge, practical and workplace modules that serve one exit level outcome.",
    offWhen:
      "This provider builds courses straight against modules, or against nothing at all. Common outside the occupational framework.",
  },
  programmes: {
    label: "Programmes",
    covers:
      "Bundling several courses into one ordered sequence a learner moves through.",
    offWhen:
      "Everything this provider runs is a single course taken on its own.",
  },
  statutory_reporting: {
    label: "Statutory reporting",
    covers:
      "NLRD and Edu.Dex exports, WSP and ATR returns, and the statutory register behind them.",
    offWhen:
      "This provider is outside South Africa, or somebody else files on their behalf.",
  },
  workplace_experience: {
    label: "Workplace experience",
    covers:
      "Workplace agreements, coach guides, sign off sheets and the hours a learner logs against a host employer.",
    offWhen:
      "Nothing this provider delivers is assessed in a workplace.",
  },
};

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as Capability[];

/** What a tenant has switched on. Absent keys are on. */
export type CapabilityFlags = Partial<Record<Capability, boolean>>;

/**
 * Whether a capability is available to this tenant.
 *
 * **Absent means on, and that is the whole safety property.** Every tenant
 * created before this existed carries an empty `featureFlags`, and Curiosa's
 * is empty on production today. Reading a missing key as "off" would have
 * removed qualifications, study units and statutory reporting from a live
 * provider on the deploy that shipped this, silently, with the data still
 * there and no screen to reach it from.
 *
 * So a capability is off only where somebody has said so.
 */
export function can(flags: CapabilityFlags | null | undefined, capability: Capability): boolean {
  return flags?.[capability] !== false;
}

/**
 * The capabilities a tenant has, filled in.
 *
 * Used where a screen needs several at once, so it reads one object rather
 * than calling `can` five times and getting one of them wrong.
 */
export function capabilitiesOf(
  flags: CapabilityFlags | null | undefined,
): Record<Capability, boolean> {
  return Object.fromEntries(
    CAPABILITY_KEYS.map((key) => [key, can(flags, key)]),
  ) as Record<Capability, boolean>;
}

/**
 * The flags a form posted, as they should be stored.
 *
 * Only the ones switched off are written. Storing `true` for everything else
 * would work, and would mean a capability added later arrives switched off for
 * every tenant that has ever saved this form, because their stored object says
 * nothing about it and the form that wrote it did not know it existed. Storing
 * the exceptions keeps "absent means on" true for the future as well as the
 * past.
 */
export function flagsFrom(chosen: Record<string, boolean>): CapabilityFlags {
  const stored: CapabilityFlags = {};
  for (const key of CAPABILITY_KEYS) {
    if (chosen[key] === false) stored[key] = false;
  }
  return stored;
}
