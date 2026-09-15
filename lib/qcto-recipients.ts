/**
 * Where each QCTO submission actually goes.
 *
 * Three different addresses, and the platform knew none of them. Taken from
 * Curiosa's own procedures:
 *
 *   `CA - Learner Enrolment Process` sends the LEISA to
 *   learnerenrolments@qcto.org.za for a full or part qualification, and to
 *   splearnerenrolments@qcto.org.za for a skills programme - two different
 *   addresses in the same procedure, distinguished only by what the learner is
 *   enrolled on.
 *
 *   `CA - Learner EISA Registration Process` sends the EISA readiness
 *   submission, with the statements of results, to eisareadiness@qcto.org.za.
 *
 * Worth holding rather than leaving to memory. A workbook that is correct in
 * every cell and sent to the wrong address has not been submitted, and the
 * provider finds out when the acknowledgement never comes - by which time the
 * twenty-one working days have usually gone.
 *
 * Addresses rather than a mail integration: the platform does not send these.
 * A person attaches the workbook and asks for an acknowledgement, because the
 * acknowledgement is the evidence and it comes back to a human mailbox.
 *
 * Pure on purpose - no imports - so a screen can show the address without
 * dragging the database in.
 */

export type SubmissionKind =
  /** Enrolment of learners on a full or part qualification. */
  | "enrolment_qualification"
  /** Enrolment of learners on a skills programme. */
  | "enrolment_skills_programme"
  /** Registering a cohort as ready for the external assessment. */
  | "eisa_readiness";

export type Recipient = {
  address: string;
  /** What is sent there, in the procedure's own terms. */
  sends: string;
  /** Which of Curiosa's procedures says so. */
  source: string;
  /** Anything that must go with it. */
  enclose?: string;
};

export const QCTO_RECIPIENTS: Record<SubmissionKind, Recipient> = {
  enrolment_qualification: {
    address: "learnerenrolments@qcto.org.za",
    sends: "The LEISA for learners enrolled on a full or part qualification",
    source: "Learner Enrolment Process",
  },
  enrolment_skills_programme: {
    address: "splearnerenrolments@qcto.org.za",
    sends: "The LEISA for learners enrolled on a skills programme",
    source: "Learner Enrolment Process",
    enclose:
      "Two FISA instruments and their supporting documentation go to the QCTO for approval as well.",
  },
  eisa_readiness: {
    address: "eisareadiness@qcto.org.za",
    sends: "The EISA readiness submission",
    source: "Learner EISA Registration Process",
    enclose: "Send the statements of results with it.",
  },
};

/**
 * Which address an enrolment notification goes to, by what the learners are on.
 *
 * The distinction the procedure draws is between a skills programme and
 * everything else, so that is the distinction drawn here. An unknown kind gets
 * the qualification address, which is the more common of the two - but
 * `recipientIsCertain` below says so, because quietly guessing an address is
 * the failure this file exists to prevent.
 */
export function enrolmentRecipient(
  kind: "full" | "part" | "skills_programme" | null,
): Recipient {
  return kind === "skills_programme"
    ? QCTO_RECIPIENTS.enrolment_skills_programme
    : QCTO_RECIPIENTS.enrolment_qualification;
}

/** Whether the kind was known, or the address is a default standing in. */
export function recipientIsCertain(
  kind: "full" | "part" | "skills_programme" | null,
): boolean {
  return kind !== null;
}

/**
 * A submission covering both kinds at once has no single address.
 *
 * It has to be split and sent twice, which is worth saying plainly on the
 * screen rather than letting somebody attach one workbook to one email.
 */
export function recipientsFor(
  kinds: ("full" | "part" | "skills_programme" | null)[],
): Recipient[] {
  const seen = new Map<string, Recipient>();
  for (const kind of kinds) {
    const recipient = enrolmentRecipient(kind);
    seen.set(recipient.address, recipient);
  }
  return [...seen.values()];
}
