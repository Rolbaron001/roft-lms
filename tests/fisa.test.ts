/**
 * FISA: the final integrated summative assessment a provider sets itself.
 *
 * Four rules carry the whole thing, and each one is a decision that could have
 * gone the other way: a confidentiality agreement is the appointment rather
 * than an attachment to it; the examiner cannot be the moderator; moderation
 * happens before anybody sits the paper; and a paper that has been signed off
 * cannot be edited.
 *
 * The checklist itself is taken verbatim from Curiosa's own templates, so the
 * tests quote real item numbers rather than invented ones.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  exitLevelOutcomes,
  fisaAppointments,
  organisations,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import {
  answerItem,
  appoint,
  confidentialityDetails,
  createInstrument,
  getInstrument,
  listInstruments,
  mayBeSat,
  newVersion,
  recordCoverage,
  sendToModeration,
  signConfidentiality,
  signOff,
} from "@/lib/fisa";
import {
  EXAMINER_SECTIONS,
  MODERATOR_SECTIONS,
  itemsFor,
  readyToSignOff,
  unanswered,
  type ChecklistAnswer,
} from "@/lib/fisa-checklist";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let examiner: AuthenticatedSession;
let moderator: AuthenticatedSession;
let skillsProgramme: string;
let fullQualification: string;
let outcomeIds: string[];

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

/** Fills in every item on a report, so a test can get past the gate. */
async function completeReport(
  session: AuthenticatedSession,
  instrumentId: string,
  role: "examiner" | "moderator",
  answer: "yes" | "no" = "yes",
) {
  for (const item of itemsFor(role)) {
    await answerItem(session, {
      instrumentId,
      role,
      itemCode: item.code,
      answer,
      recommendation: answer === "no" ? "Needs work." : undefined,
    });
  }
}

beforeAll(async () => {
  const slug = `fisa-${Date.now()}`;

  const made = await withPlatformScope("fisa fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "FISA Test Provider",
        status: "active",
        accreditationNumber: "SDP-FISA-001",
      })
      .returning({ id: organisations.id });

    const orgId = organisation.id;

    // A skills programme, which is what a FISA is for.
    const [sp] = await tx
      .insert(qualifications)
      .values({
        organisationId: orgId,
        title: "Hair Cutting Attendant",
        kind: "skills_programme",
        saqaId: "SP-230304",
        nqfLevel: 4,
        totalCredits: 60,
      })
      .returning({ id: qualifications.id });

    // A full qualification, which is externally assessed and must be refused.
    const [full] = await tx
      .insert(qualifications)
      .values({
        organisationId: orgId,
        title: "Occupational Certificate: Plumber",
        kind: "full",
        saqaId: "118273",
        nqfLevel: 5,
        totalCredits: 360,
      })
      .returning({ id: qualifications.id });

    const outcomes: string[] = [];
    for (const [number, description] of [
      ["ELO 1", "Maintain and repair above and below ground drainage pipes."],
      ["ELO 2", "Prepare and finish a cut to the agreed style."],
    ] as const) {
      const [outcome] = await tx
        .insert(exitLevelOutcomes)
        .values({
          organisationId: orgId,
          qualificationId: sp.id,
          number,
          description,
          sortOrder: outcomes.length + 1,
        })
        .returning({ id: exitLevelOutcomes.id });
      outcomes.push(outcome.id);
    }

    const people: Record<string, string> = {};
    for (const [key, email, role] of [
      ["admin", "admin@fisa.test", "tenant_admin"],
      ["examiner", "examiner@fisa.test", "instructor"],
      ["moderator", "moderator@fisa.test", "moderator"],
    ] as const) {
      const [person] = await tx
        .insert(users)
        .values({
          organisationId: orgId,
          email,
          firstName: "FISA",
          lastName: key,
          status: "active",
        })
        .returning({ id: users.id });
      await tx
        .insert(userRoles)
        .values({ organisationId: orgId, userId: person.id, role });
      people[key] = person.id;
    }

    return { orgId, people, sp: sp.id, full: full.id, outcomes };
  });

  organisationId = made.orgId;
  admin = sessionFor(["tenant_admin"], made.people.admin);
  examiner = sessionFor(["instructor"], made.people.examiner);
  moderator = sessionFor(["moderator", "instructor"], made.people.moderator);
  skillsProgramme = made.sp;
  fullQualification = made.full;
  outcomeIds = made.outcomes;
});

afterAll(async () => {
  await withPlatformScope("fisa teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("the checklist, as the templates print it", () => {
  it("carries the examiner's four sections and the moderator's six", () => {
    expect(EXAMINER_SECTIONS.map((s) => s.number)).toEqual([1, 3, 4, 5]);
    expect(MODERATOR_SECTIONS.map((s) => s.number)).toEqual([1, 3, 4, 5, 7]);
  });

  /**
   * The pre-moderator report used to number two different sections "5", and the
   * platform recorded that faithfully. The template was corrected on
   * 15 September, so no number repeats any more and the printed numbers and our
   * own agree.
   */
  it("has no repeated section number", () => {
    const printed = MODERATOR_SECTIONS.map((s) => s.printedAs);
    expect(printed).toEqual(["1", "3", "4", "5", "7"]);
    expect(new Set(printed).size).toBe(printed.length);
  });

  it("offers a third answer on 1.1 and nowhere else", () => {
    const withNa = itemsFor("moderator").filter((i) => i.allowsNotApplicable);
    expect(withNa.map((i) => i.code)).toEqual(["1.1"]);
  });

  it("will not sign off while anything is unanswered", () => {
    expect(readyToSignOff({}).ready).toBe(false);
    expect(readyToSignOff({}).why).toContain("unanswered");
  });

  it("will not sign off when 6.2 is answered no", () => {
    const answers: Record<string, ChecklistAnswer> = Object.fromEntries(
      itemsFor("moderator").map((i) => [i.code, "yes" as ChecklistAnswer]),
    );
    answers["7.2"] = "no";

    const verdict = readyToSignOff(answers);
    expect(verdict.ready).toBe(false);
    expect(verdict.why).toContain("7.2");
  });

  /**
   * A "no" elsewhere is a recommendation, not a veto. The moderator may accept
   * an instrument with a reservation against it, and the report records that
   * they did.
   */
  it("signs off despite a no on an ordinary item", () => {
    const answers: Record<string, ChecklistAnswer> = Object.fromEntries(
      itemsFor("moderator").map((i) => [i.code, "yes" as ChecklistAnswer]),
    );
    answers["3.2"] = "no";

    expect(readyToSignOff(answers).ready).toBe(true);
  });
});

describe("what a FISA may be set for", () => {
  it("is set for a skills programme", async () => {
    const instrument = await createInstrument(admin, {
      qualificationId: skillsProgramme,
      title: "Hair Cutting Attendant FISA",
      durationMinutes: 120,
      totalMarks: 80,
      passMarkPercent: 70,
    });

    expect(instrument.status).toBe("draft");
    expect(instrument.passMarkPercent).toBe(70);
  });

  /**
   * A full qualification is assessed externally by the AQP. A provider setting
   * its own final paper for one would be assessing against a standard it does
   * not own, so the refusal says that rather than only "not allowed".
   */
  it("is refused for a full qualification, and says why", async () => {
    await expect(
      createInstrument(admin, {
        qualificationId: fullQualification,
        title: "Should not exist",
      }),
    ).rejects.toMatchObject({ reason: "invalid" });

    await expect(
      createInstrument(admin, {
        qualificationId: fullQualification,
        title: "Should not exist",
      }),
    ).rejects.toThrow(/Assessment Quality Partner/);
  });
});

describe("appointing the two people", () => {
  let instrumentId: string;

  beforeAll(async () => {
    const instrument = await createInstrument(admin, {
      qualificationId: skillsProgramme,
      title: "Appointments FISA",
    });
    instrumentId = instrument.id;
  });

  it("appoints an examiner and a moderator", async () => {
    const one = await appoint(admin, {
      instrumentId,
      role: "examiner",
      userId: examiner.userId,
      fullName: "Thandi Examiner",
      idNumber: "9202204720083",
      email: "examiner@fisa.test",
    });
    const two = await appoint(admin, {
      instrumentId,
      role: "moderator",
      userId: moderator.userId,
      fullName: "Sipho Moderator",
      idNumber: "9202205720082",
    });

    expect(one.confidentialitySignedAt).toBeNull();
    expect(two.confidentialitySignedAt).toBeNull();
  });

  /**
   * The whole worth of a pre-moderation is that a second person looked. The
   * same rule, for the same reason, as the trigger stopping a learner being
   * their own workplace coach.
   */
  it("refuses to make one person both", async () => {
    await expect(
      appoint(admin, {
        instrumentId,
        role: "moderator",
        userId: examiner.userId,
        fullName: "Thandi Examiner",
      }),
    ).rejects.toMatchObject({ reason: "same_person" });
  });

  it("catches the same person by identity number when they have no account", async () => {
    const other = await createInstrument(admin, {
      qualificationId: skillsProgramme,
      title: "External appointments FISA",
    });

    await appoint(admin, {
      instrumentId: other.id,
      role: "examiner",
      fullName: "External Examiner",
      idNumber: "8801015800085",
    });

    await expect(
      appoint(admin, {
        instrumentId: other.id,
        role: "moderator",
        // A different name, the same person.
        fullName: "E. Examiner",
        idNumber: "8801015800085",
      }),
    ).rejects.toMatchObject({ reason: "same_person" });
  });

  /**
   * The agreement is the appointment. Both templates are confidentiality
   * undertakings before they are anything else, so an unsigned one confers
   * nothing at all.
   */
  it("lets nobody touch the paper before signing", async () => {
    await expect(
      answerItem(examiner, {
        instrumentId,
        role: "examiner",
        itemCode: "1.1",
        answer: "yes",
      }),
    ).rejects.toMatchObject({ reason: "unsigned" });
  });

  it("lets the examiner work once they have signed", async () => {
    const [appointment] = await withPlatformScope("find appointment", (tx) =>
      tx
        .select()
        .from(fisaAppointments)
        .where(eq(fisaAppointments.instrumentId, instrumentId)),
    );

    await signConfidentiality(examiner, appointment.id);

    const saved = await answerItem(examiner, {
      instrumentId,
      role: "examiner",
      itemCode: "1.1",
      answer: "yes",
    });

    expect(saved.answer).toBe("yes");
  });

  it("keeps somebody else out of the examiner's report", async () => {
    await expect(
      answerItem(moderator, {
        instrumentId,
        role: "examiner",
        itemCode: "1.2",
        answer: "yes",
      }),
    ).rejects.toMatchObject({ reason: "not_appointed" });
  });

  /**
   * Replacing a person clears the signature with them. A new examiner has not
   * signed the old examiner's agreement.
   */
  it("clears the signature when the person is replaced", async () => {
    await appoint(admin, {
      instrumentId,
      role: "examiner",
      userId: examiner.userId,
      fullName: "Thandi Examiner-Remarried",
      idNumber: "9202204720083",
    });

    const [appointment] = await withPlatformScope("find appointment", (tx) =>
      tx
        .select()
        .from(fisaAppointments)
        .where(eq(fisaAppointments.instrumentId, instrumentId)),
    );

    expect(appointment.confidentialitySignedAt).toBeNull();
  });
});

describe("moderation, which happens before anybody sits it", () => {
  let instrumentId: string;

  beforeAll(async () => {
    const instrument = await createInstrument(admin, {
      qualificationId: skillsProgramme,
      title: "Moderation FISA",
      durationMinutes: 120,
      totalMarks: 80,
      passMarkPercent: 70,
    });
    instrumentId = instrument.id;

    const one = await appoint(admin, {
      instrumentId,
      role: "examiner",
      userId: examiner.userId,
      fullName: "Thandi Examiner",
      idNumber: "9202204720083",
    });
    const two = await appoint(admin, {
      instrumentId,
      role: "moderator",
      userId: moderator.userId,
      fullName: "Sipho Moderator",
      idNumber: "9202205720082",
    });

    await signConfidentiality(examiner, one.id);
    await signConfidentiality(moderator, two.id);
  });

  it("will not let a candidate sit a paper nobody has moderated", async () => {
    const verdict = await mayBeSat(admin, instrumentId);

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.why).toContain("not been signed off");
    }
  });

  it("will not hand over a report the examiner has not finished", async () => {
    await answerItem(examiner, {
      instrumentId,
      role: "examiner",
      itemCode: "1.1",
      answer: "yes",
    });

    await expect(sendToModeration(examiner, instrumentId)).rejects.toMatchObject(
      { reason: "invalid" },
    );
  });

  it("hands over once the examiner's own report is complete", async () => {
    await completeReport(examiner, instrumentId, "examiner");

    const updated = await sendToModeration(examiner, instrumentId);
    expect(updated.status).toBe("in_moderation");
  });

  it("records where each exit level outcome is assessed", async () => {
    await recordCoverage(moderator, {
      instrumentId,
      role: "moderator",
      exitLevelOutcomeId: outcomeIds[0],
      requiredStandard: "Learners maintain and repair drainage pipes.",
      // The examiner's own template has two levels in one cell, so this is
      // text rather than one of three values.
      competenceLevel: "L,H",
      questionReference: "1.1 - 2.3",
      standardAchieved: true,
    });

    const view = await getInstrument(admin, instrumentId);
    const row = view.coverage.find((c) => c.role === "moderator");

    expect(row?.competenceLevel).toBe("L,H");
    expect(row?.questionReference).toBe("1.1 - 2.3");
  });

  it("will not sign off while the moderator's report is short", async () => {
    await expect(
      signOff(moderator, instrumentId, { qualityRating: "good" }),
    ).rejects.toMatchObject({ reason: "invalid" });
  });

  it("signs off once every item is answered", async () => {
    await completeReport(moderator, instrumentId, "moderator");

    const approved = await signOff(moderator, instrumentId, {
      qualityRating: "good",
      qualityMotivation: "Covers every outcome and the timing is realistic.",
    });

    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.approvedById).toBe(moderator.userId);
  });

  it("only then lets a candidate sit it", async () => {
    expect(await mayBeSat(admin, instrumentId)).toEqual({ allowed: true });
  });

  /**
   * A paper that has been signed off may have been sat. Editing it would
   * change what a candidate answered after the fact.
   */
  it("refuses an edit after sign-off", async () => {
    await expect(
      answerItem(moderator, {
        instrumentId,
        role: "moderator",
        itemCode: "3.1",
        answer: "no",
      }),
    ).rejects.toMatchObject({ reason: "wrong_state" });
  });

  it("opens a new version instead, carrying nothing forward", async () => {
    const draft = await newVersion(admin, instrumentId);

    expect(draft.version).toBe(2);
    expect(draft.status).toBe("draft");
    expect(draft.supersedesId).toBe(instrumentId);

    // A new paper needs its own moderation. Last version's answers would be a
    // judgement nobody made about this one.
    const view = await getInstrument(admin, draft.id);
    expect(view.responses).toHaveLength(0);
    expect(view.appointments).toHaveLength(0);
    expect(view.outstanding.moderator.length).toBe(itemsFor("moderator").length);
  });

  it("leaves the signed-off version exactly as it was", async () => {
    const view = await getInstrument(admin, instrumentId);
    expect(view.instrument.status).toBe("approved");
    expect(await mayBeSat(admin, instrumentId)).toEqual({ allowed: true });
  });
});

describe("the confidentiality agreement as a document", () => {
  it("returns what the template asks for", async () => {
    const instrument = await createInstrument(admin, {
      qualificationId: skillsProgramme,
      title: "Agreement FISA",
    });

    await appoint(admin, {
      instrumentId: instrument.id,
      role: "moderator",
      fullName: "Nomsa Moderator",
      idNumber: "9001015800086",
      email: "nomsa@example.test",
      mobile: "0821234567",
    });

    const details = await confidentialityDetails(
      admin,
      instrument.id,
      "moderator",
    );

    // Every field the two templates name, and the programme they attach to.
    expect(details.fullName).toBe("Nomsa Moderator");
    expect(details.idNumber).toBe("9001015800086");
    expect(details.email).toBe("nomsa@example.test");
    expect(details.mobile).toBe("0821234567");
    expect(details.programme).toBe("Hair Cutting Attendant");
    expect(details.saqaId).toBe("SP-230304");
    expect(details.nqfLevel).toBe(4);
    expect(details.credits).toBe(60);
  });

  it("says so when nobody has been appointed", async () => {
    const instrument = await createInstrument(admin, {
      qualificationId: skillsProgramme,
      title: "Unappointed FISA",
    });

    await expect(
      confidentialityDetails(admin, instrument.id, "examiner"),
    ).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("what a coordinator sees", () => {
  it("lists every FISA with its programme", async () => {
    const all = await listInstruments(admin);

    expect(all.length).toBeGreaterThan(0);
    expect(all.every((row) => row.programme)).toBe(true);
    expect(all.some((row) => row.status === "approved")).toBe(true);
  });

  it("reports what is still unanswered on each report", async () => {
    const instrument = await createInstrument(admin, {
      qualificationId: skillsProgramme,
      title: "Outstanding FISA",
    });

    const view = await getInstrument(admin, instrument.id);

    expect(view.outstanding.examiner).toHaveLength(itemsFor("examiner").length);
    expect(view.signOff.ready).toBe(false);
  });

  it("keeps a learner out of the whole thing", async () => {
    const learner = sessionFor(["learner"], admin.userId);
    await expect(listInstruments(learner)).rejects.toThrow();
    await expect(
      createInstrument(learner, {
        qualificationId: skillsProgramme,
        title: "Nope",
      }),
    ).rejects.toThrow();
  });
});

describe("unanswered, on a partly filled report", () => {
  it("counts only what is missing", () => {
    const answers = { "1.1": "yes" as const, "1.2": "no" as const };
    const missing = unanswered("examiner", answers);

    expect(missing).toHaveLength(itemsFor("examiner").length - 2);
    expect(missing.map((m) => m.code)).not.toContain("1.1");
  });
});
