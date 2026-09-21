/**
 * What a tenant's platform is, and how its people see it.
 *
 * Roland, 21 September 2026: "I need the system to be flexible per client."
 * Not every client is in South Africa, not every client seeks accreditation,
 * and a corporate client may be accredited all the same, as the prospective
 * Ranger clients would be. The choice is about what a tenant does, never about
 * what kind of organisation it is.
 *
 * **This began as five independent switches and that was wrong.** Roland, the
 * same afternoon: "We have already determined that Course and Study Unit are
 * the same thing in terms of where they rank. What the selection needs to do
 * is to determine how the users view them."
 *
 * Independent switches let somebody produce a platform that cannot exist: study
 * units with no qualification to sit inside, or a separate Programme layer on a
 * provider for whom the qualification *is* the programme. A checkbox each says
 * the layers are optional. They are not optional, they are named differently by
 * different providers, and two of them are one thing seen twice.
 *
 * So there are two questions rather than five, each with one answer:
 *
 *   **What sits at the top.** Some providers deliver one qualification as one
 *   learning programme, so the two are one thing to them. Heidi: "we have
 *   programmes, not courses ... at this stage a qualification is a programme."
 *   Elsewhere they are two different things, or there is no qualification.
 *
 *   **What a learner works through.** A Course and a Study Unit occupy the same
 *   rank. Choosing one is choosing the word and the shape together, which is
 *   why choosing it also settles the terminology.
 *
 * **Neither word is the regulator's, and the platform must not imply it is.**
 * Counted on 21 September in the project's own documents: "study unit" appears
 * zero times in the 121151 curriculum, its qualification document, its
 * assessment specification, the 118709 curriculum and SAQA's NQFpedia.
 * "Course" appears zero times in the four QCTO documents and three times in
 * NQFpedia, never as a defined term. The regulator's word for this layer is
 * **learning programme**, and SAQA keeps it distinct from a qualification: a
 * learning programme "leads to" one. So these are offered as a provider's own
 * vocabulary, and no screen claims the QCTO requires either.
 *
 * Two ordinary switches remain beside them, because statutory returns and
 * workplace assessment genuinely are independent of both questions.
 *
 * The three tier model underneath does not change. Roland's working paper of
 * 28 August checked it against SAQA, DHET, the QCTO, Ofqual, the US CEDS
 * standard, Moodle Workplace, Coursera and edX, and none of the seven collapses
 * the atomic teaching unit into the bundle above it. What changes is which
 * layers a provider is shown and what each is called.
 *
 * This module imports nothing, so a form can use it.
 */

/** What sits at the top of this provider's world. */
export type Award =
  | "qualification_programme"
  | "qualification_and_programme"
  | "programmes_only"
  | "standalone";

/** What a learner is put onto and works through. */
export type Delivery = "courses" | "study_units";

export type Structure = {
  award: Award;
  delivery: Delivery;
  statutory_reporting: boolean;
  workplace_experience: boolean;
};

export type Choice<T extends string> = {
  value: T;
  label: string;
  covers: string;
  /** Who this is for, in the words a provider would use about themselves. */
  chooseWhen: string;
};

export const AWARD_CHOICES: Choice<Award>[] = [
  {
    value: "qualification_programme",
    label: "Qualification / Programme",
    covers:
      "One thing. A learner is put onto the qualification and that is what they work through. There is no separate bundling layer above it.",
    chooseWhen:
      "You deliver one occupational qualification as one learning programme. This is Curiosa's shape.",
  },
  {
    value: "qualification_and_programme",
    label: "Qualification and Programme, separately",
    covers:
      "Two different things. A qualification holds the accreditation and the curriculum; a programme bundles what a learner works through, and may answer to a qualification or to none.",
    chooseWhen:
      "You run accredited qualifications and also bundle deliverables into sequences that are not one qualification each.",
  },
  {
    value: "programmes_only",
    label: "Programmes only",
    covers:
      "Programmes bundle what a learner works through. No accreditation record, no curriculum, no statements of results.",
    chooseWhen:
      "Nothing you deliver answers to a registered qualification: induction, compliance refreshers, internal skills programmes.",
  },
  {
    value: "standalone",
    label: "Neither",
    covers:
      "Everything stands on its own. Nothing bundles it and nothing accredits it.",
    chooseWhen:
      "Every piece of training you run is taken on its own, one at a time.",
  },
];

export const DELIVERY_CHOICES: Choice<Delivery>[] = [
  {
    value: "courses",
    label: "Courses",
    covers:
      "A course is what a learner is put onto and works through: its lessons, its workbooks, its assessments. It may sit under a programme, and it need answer to no qualification.",
    chooseWhen:
      "Your people say course, or you build training that no qualification governs.",
  },
  {
    value: "study_units",
    label: "Study units",
    covers:
      "A study unit is what a learner works through, and it replaces the course entirely. It sits inside a qualification, bundling the knowledge, practical and workplace modules that serve one exit level outcome.",
    chooseWhen:
      "Your people say study unit rather than course. The curriculum publishes modules and leaves the grouping to you, so this is your own structure. Requires a qualification at the top.",
  },
];

/**
 * The default, which is today's behaviour rather than an opinion.
 *
 * Every tenant created before this existed has an empty record, and Curiosa's
 * is empty on production. They currently see Qualifications, Programmes and
 * Courses, so that is what an unconfigured tenant must keep seeing. Anything
 * else would change a live provider's platform on the deploy that shipped
 * this, silently.
 */
export const DEFAULT_STRUCTURE: Structure = {
  award: "qualification_and_programme",
  delivery: "courses",
  statutory_reporting: true,
  workplace_experience: true,
};

/** Whatever is stored, read as a whole structure. Absent parts take the default. */
export function structureOf(
  stored: Partial<Structure> | null | undefined,
): Structure {
  const award = AWARD_CHOICES.some((one) => one.value === stored?.award)
    ? (stored!.award as Award)
    : DEFAULT_STRUCTURE.award;

  const delivery = DELIVERY_CHOICES.some((one) => one.value === stored?.delivery)
    ? (stored!.delivery as Delivery)
    : DEFAULT_STRUCTURE.delivery;

  return {
    award,
    // Study units cannot exist without a qualification to sit inside. Stored
    // state can say otherwise if somebody edits the record by hand or changes
    // the award without the delivery; reading it back corrects it rather than
    // producing a platform that cannot exist.
    delivery: delivery === "study_units" && !hasQualification(award)
      ? "courses"
      : delivery,
    statutory_reporting: stored?.statutory_reporting !== false,
    workplace_experience: stored?.workplace_experience !== false,
  };
}

function hasQualification(award: Award): boolean {
  return (
    award === "qualification_programme" ||
    award === "qualification_and_programme"
  );
}

/**
 * Whether study units may be chosen at all, given what sits at the top.
 *
 * Roland: "Selecting one of the 2 makes the other un-selectable." This is the
 * rule behind that. A study unit is a grouping inside a registered
 * qualification, so a provider with no qualification has nothing for one to
 * live in.
 */
export function deliveryAvailable(award: Award, delivery: Delivery): boolean {
  return delivery === "courses" || hasQualification(award);
}

// ---------------------------------------------------------------------------
// What the rest of the platform asks
// ---------------------------------------------------------------------------

export type Capability =
  | "qualifications"
  | "study_units"
  | "programmes"
  | "statutory_reporting"
  | "workplace_experience";

/** What a tenant has, derived from the two choices rather than stored twice. */
export type CapabilityFlags = Partial<Structure>;

/**
 * Whether a capability is available to this tenant.
 *
 * Derived, so the answer cannot disagree with the choices. Storing both the
 * choices and the capabilities would eventually produce a tenant whose
 * qualification layer is on and whose award says there is none.
 */
export function can(
  stored: CapabilityFlags | null | undefined,
  capability: Capability,
): boolean {
  const structure = structureOf(stored);

  switch (capability) {
    case "qualifications":
      return hasQualification(structure.award);
    /*
     * A separate Programmes screen, which is not the same question as whether
     * this provider has programmes. Under "Qualification / Programme" they
     * have one, and it is the qualification, so a second screen listing
     * programmes would be listing the same objects again under another name.
     */
    case "programmes":
      return (
        structure.award === "qualification_and_programme" ||
        structure.award === "programmes_only"
      );
    case "study_units":
      return structure.delivery === "study_units";
    case "statutory_reporting":
      return structure.statutory_reporting;
    case "workplace_experience":
      return structure.workplace_experience;
  }
}

export const CAPABILITY_KEYS: Capability[] = [
  "qualifications",
  "study_units",
  "programmes",
  "statutory_reporting",
  "workplace_experience",
];

export function capabilitiesOf(
  stored: CapabilityFlags | null | undefined,
): Record<Capability, boolean> {
  return Object.fromEntries(
    CAPABILITY_KEYS.map((key) => [key, can(stored, key)]),
  ) as Record<Capability, boolean>;
}

// ---------------------------------------------------------------------------
// What it is called
// ---------------------------------------------------------------------------

/**
 * Terms this structure has already settled, which nobody should be asked to
 * name a second time.
 *
 * Roland: "These selections should then also impact on 'What you call things'
 * - pointless displaying courses if the user has already selected
 * Courses/Study Units."
 *
 * Choosing study units is choosing the word. Offering a box to rename "course"
 * afterwards invites somebody to set a word the platform will never show, and
 * then to wonder why it never appears.
 */
export function settledTerms(
  stored: CapabilityFlags | null | undefined,
): string[] {
  const structure = structureOf(stored);
  const settled: string[] = [];

  // The delivery choice named it. Whichever was not chosen is not shown.
  if (structure.delivery === "study_units") settled.push("course");
  else settled.push("studyUnit");

  // Under one combined award there is no separate programme to name.
  if (
    structure.award === "qualification_programme" ||
    structure.award === "standalone"
  ) {
    settled.push("programme");
  }

  return settled;
}

// ---------------------------------------------------------------------------
// Saying it back
// ---------------------------------------------------------------------------

export type ShapeLayer = { name: string; note?: string };

/**
 * The shape these choices produce, said back to the reader.
 *
 * Roland, looking at the first version: "Neither is it clear that Programme can
 * equal Qualification and in Curiosa's case actually be the same thing."
 *
 * Derived from the choices rather than written alongside them, because a second
 * description drifts from the first, and the way it drifts is somebody changing
 * a choice while the sentence stays put.
 */
export function platformShape(
  stored: CapabilityFlags | null | undefined,
): ShapeLayer[] {
  const structure = structureOf(stored);
  const layers: ShapeLayer[] = [];

  if (structure.award === "qualification_programme") {
    layers.push({
      name: "Qualification / Programme",
      note: "One thing. A learner is put onto the qualification, and that is the programme they work through.",
    });
  }

  if (structure.award === "qualification_and_programme") {
    layers.push({
      name: "Qualification",
      note: "The accreditation record: its curriculum, criteria and exit level outcomes.",
    });
    layers.push({
      name: "Programme",
      note: "An ordered sequence, which may answer to a qualification or to none.",
    });
  }

  if (structure.award === "programmes_only") {
    layers.push({
      name: "Programme",
      note: "An ordered sequence, answering to no registered qualification.",
    });
  }

  layers.push(
    structure.delivery === "study_units"
      ? {
          name: "Study unit",
          note: "What a learner works through. There is nothing below it.",
        }
      : {
          name: "Course",
          note: "What a learner works through. There is nothing below it.",
        },
  );

  return layers;
}

/** The structure a form posted, checked rather than trusted. */
export function structureFrom(posted: {
  award?: string | null;
  delivery?: string | null;
  statutory_reporting?: boolean;
  workplace_experience?: boolean;
}): Structure {
  return structureOf({
    award: posted.award as Award,
    delivery: posted.delivery as Delivery,
    statutory_reporting: posted.statutory_reporting,
    workplace_experience: posted.workplace_experience,
  });
}
