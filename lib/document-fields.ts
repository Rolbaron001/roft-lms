/**
 * What a tenant may place in their own version of a document, and what the
 * platform will always put there whatever they do.
 *
 * The platform serves many providers, so it cannot dictate how a Statement of
 * Results looks. What it can dictate is that the sentence saying the document
 * is not an Occupational Certificate appears on it, because that sentence is
 * the QCTO's rather than the provider's.
 *
 * So a document has two halves. The **template** is the tenant's: their
 * letterhead, their wording, the fields they choose to show and the order they
 * show them in. The **statutory block** is the platform's: rendered after the
 * template, from the same data, and not removable. A tenant who deleted it
 * would be issuing a document that misrepresents what it is, and the first
 * person to find out would be a learner at an assessment centre.
 *
 * Pure on purpose: no imports, no database. A form that lets somebody build a
 * template needs this list in the browser, and anything reaching into the
 * database here would drag the Postgres driver into the bundle with it.
 */

/** The documents a tenant can supply their own template for. */
export const DOCUMENT_KINDS = [
  "statement_of_results",
  "certificate",
  "workplace_statement",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  statement_of_results: "Statement of Results",
  certificate: "Certificate",
  workplace_statement: "Statement of Work Experience",
};

export const DOCUMENT_KIND_NOTES: Record<DocumentKind, string> = {
  statement_of_results:
    "Carried to the assessment centre with the learner's identity document. The QCTO's own template is in the project's Design folder as an example of what one carries; this is yours to lay out.",
  certificate:
    "What the provider issues for its own programmes. A qualification certificate comes from the QCTO, not from here.",
  workplace_statement:
    "What a workplace coach signs to confirm the experience a learner completed.",
};

/**
 * A field a template may place.
 *
 * `example` is shown beside the field on the screen where somebody builds a
 * template, because "what does `qualification.nqfLevel` actually look like" is
 * the question they will have, and answering it with a real value is faster
 * than any description.
 */
export type DocumentField = {
  /** Written in a template as {{ this }}. */
  key: string;
  label: string;
  example: string;
  /** True when the field is a list the template repeats over. */
  repeating?: boolean;
};

const LEARNER_FIELDS: DocumentField[] = [
  { key: "learner.fullName", label: "Learner's full name", example: "Thandi Mokoena" },
  { key: "learner.firstName", label: "First name", example: "Thandi" },
  { key: "learner.lastName", label: "Surname", example: "Mokoena" },
  {
    key: "learner.nationalId",
    label: "Identity number",
    example: "9203155009087",
  },
];

const PROVIDER_FIELDS: DocumentField[] = [
  {
    key: "provider.name",
    label: "Provider's name",
    example: "Curiosa Academy",
  },
  {
    key: "provider.address",
    label: "Provider's address",
    example: "14 Curiosity Lane, Johannesburg",
  },
  {
    key: "provider.accreditationNumber",
    label: "Accreditation number",
    example: "QCTO/SDP/22/0001",
  },
];

const DOCUMENT_META_FIELDS: DocumentField[] = [
  { key: "document.issuedOn", label: "Date of issue", example: "9 September 2026" },
  {
    key: "document.reference",
    label: "Verification reference",
    example: "ROFT-BRWSR-CHECK-STMNT-TEST2",
  },
];

const QUALIFICATION_FIELDS: DocumentField[] = [
  {
    key: "qualification.title",
    label: "Qualification title",
    example: "Occupational Certificate: Commercial Cleaner",
  },
  { key: "qualification.saqaId", label: "SAQA identifier", example: "118709" },
  {
    key: "qualification.curriculumCode",
    label: "Curriculum code",
    example: "811201-000-00",
  },
  { key: "qualification.nqfLevel", label: "NQF level", example: "4" },
  { key: "qualification.credits", label: "Total credits", example: "120" },
  {
    key: "qualification.assessmentQualityPartner",
    label: "Assessment Quality Partner",
    example: "Services SETA",
  },
];

export const DOCUMENT_FIELDS: Record<DocumentKind, DocumentField[]> = {
  statement_of_results: [
    ...LEARNER_FIELDS,
    ...QUALIFICATION_FIELDS,
    {
      key: "studyUnit.title",
      label: "Study unit, where the statement covers one",
      example: "SU1: Preparing the work area",
    },
    {
      key: "statement.validUntil",
      label: "Valid until",
      example: "9 September 2028",
    },
    {
      key: "statement.admittedToEisa",
      label: "Admitted to the EISA",
      example: "Yes",
    },
    { key: "statement.nextEisa", label: "Date of next EISA", example: "12 November 2026" },
    {
      key: "modules",
      label: "The modules, with credits, result and date",
      example: "A table of every module the learner completed",
      repeating: true,
    },
    ...PROVIDER_FIELDS,
    ...DOCUMENT_META_FIELDS,
  ],
  /**
   * A certificate carries less than a Statement of Results, and the list says
   * so rather than offering fields the platform cannot fill.
   *
   * It has no SAQA identifier, no curriculum code and no credit total, because
   * a certificate is the provider's own award: a qualification certificate
   * comes from the QCTO. Offering `qualification.saqaId` here would have been
   * exactly the fault the platform refuses a tenant for - a field that renders
   * blank on a printed document and is noticed by the person holding it.
   */
  certificate: [
    ...LEARNER_FIELDS,
    {
      key: "certificate.title",
      label: "What the certificate is for",
      example: "Introduction to Commercial Cleaning",
    },
    {
      key: "certificate.awardedOn",
      label: "Date awarded",
      example: "1 August 2026",
    },
    {
      key: "certificate.expiresOn",
      label: "Expires on, where it does",
      example: "1 August 2029",
    },
    {
      key: "competencies",
      label: "The competencies attested to",
      example: "A list of what the certificate says the holder can do",
      repeating: true,
    },
    ...PROVIDER_FIELDS,
    ...DOCUMENT_META_FIELDS,
  ],
  workplace_statement: [
    ...LEARNER_FIELDS,
    {
      key: "module.code",
      label: "Work experience module code",
      example: "811201-000-00-WM-01",
    },
    {
      key: "module.title",
      label: "Module title",
      example: "Procedures for Completing Before Shift Duties",
    },
    { key: "module.credits", label: "Credits", example: "4" },
    { key: "workplace.employer", label: "Employer", example: "Acme Mining Services" },
    {
      key: "workplace.employerAddress",
      label: "Employer's address",
      example: "12 Reef Road, Boksburg",
    },
    { key: "workplace.coach", label: "Workplace coach", example: "Sipho Dlamini" },
    {
      key: "workplace.coachDesignation",
      label: "Coach's designation",
      example: "Site Supervisor",
    },
    { key: "workplace.hours", label: "Hours completed", example: "160" },
    {
      key: "workplace.signedOn",
      label: "Date the coach signed",
      example: "28 August 2026",
    },
    {
      key: "entries",
      label: "The work experience recorded",
      example: "A list of what the learner did, by kind",
      repeating: true,
    },
    ...PROVIDER_FIELDS,
    ...DOCUMENT_META_FIELDS,
  ],
};

/**
 * What the platform renders after the template, whatever the template says.
 *
 * Each of these exists because somebody outside the provider requires it. They
 * are listed here so the screen that builds a template can show them: a tenant
 * seeing what will be added is far less likely to duplicate it, and nobody
 * discovers an unremovable paragraph after issuing forty documents.
 */
export const STATUTORY_BLOCKS: Record<DocumentKind, string[]> = {
  statement_of_results: [
    "This Statement of Results is not an Occupational Certificate. The learner must comply with the requirements of the Knowledge, Practical and Workplace components of the qualification in order to be admitted to the External Integrated Summative Assessment. This Statement of Results is valid for a period of two years from the date of issue.",
    "The Quality Council for Trades and Occupations will issue the Occupational Certificate upon successful completion of the External Integrated Summative Assessment, and having met the requirements of the qualification.",
    "This statement can be checked by entering the verification reference above.",
  ],
  certificate: [
    "This certificate is issued by the provider named on it. It is not a national qualification and carries no credits on the National Qualifications Framework unless it says so.",
    "This certificate can be checked by entering the verification reference above.",
  ],
  workplace_statement: [
    "This statement records workplace experience signed off by the coach named on it. It is not an assessment decision and does not on its own confirm competence.",
  ],
};

/**
 * What a provider starts from, rather than an empty box.
 *
 * An empty textarea and a list of forty field names is a worse invitation than
 * it looks: the first thing anybody does is guess at a layout, and the second
 * is discover they have left out the reference. So each of these is the
 * platform's own wording, already laid out and already carrying the fields that
 * matter, for a provider to edit down into their own.
 *
 * They deliberately do **not** repeat anything in `STATUTORY_BLOCKS`. Those are
 * printed after whatever the template says, and a starter that included them
 * would teach every provider to duplicate them.
 */
export const STARTER_TEMPLATES: Record<DocumentKind, string> = {
  statement_of_results: [
    "{{ provider.name }}",
    "{{ provider.address }}",
    "",
    "STATEMENT OF RESULTS",
    "",
    "Issued to      {{ learner.fullName }}",
    "Identity no    {{ learner.nationalId }}",
    "",
    "Qualification  {{ qualification.title }}",
    "SAQA ID        {{ qualification.saqaId }}",
    "Curriculum     {{ qualification.curriculumCode }}",
    "NQF level      {{ qualification.nqfLevel }}",
    "Credits        {{ qualification.credits }}",
    "",
    "MODULES COMPLETED",
    "{{ modules }}",
    "",
    "Admitted to the EISA   {{ statement.admittedToEisa }}",
    "Date of next EISA      {{ statement.nextEisa }}",
    "",
    "The provider named above confirms that the learner named above has",
    "achieved all internal assessment criteria for all modules in the",
    "curriculum document for this qualification.",
    "",
    "Issued on      {{ document.issuedOn }}",
    "Valid until    {{ statement.validUntil }}",
    "Reference      {{ document.reference }}",
    "Accreditation  {{ provider.accreditationNumber }}",
    "",
    "",
    "Name of Principal / Academic Manager   ____________________________",
    "",
    "Designation                            ____________________________",
    "",
    "Signature                              ____________________________",
  ].join("\n"),

  certificate: [
    "{{ provider.name }}",
    "{{ provider.address }}",
    "",
    "CERTIFICATE OF COMPLETION",
    "",
    "This is to certify that",
    "",
    "        {{ learner.fullName }}",
    "",
    "has completed",
    "",
    "        {{ certificate.title }}",
    "",
    "WHAT THIS ATTESTS TO",
    "{{ competencies }}",
    "",
    "Awarded on     {{ certificate.awardedOn }}",
    "Reference      {{ document.reference }}",
    "Accreditation  {{ provider.accreditationNumber }}",
    "",
    "",
    "Signed for {{ provider.name }}   ____________________________",
  ].join("\n"),

  workplace_statement: [
    "{{ provider.name }}",
    "",
    "STATEMENT OF WORK EXPERIENCE",
    "",
    "Learner        {{ learner.fullName }}",
    "Identity no    {{ learner.nationalId }}",
    "",
    "Module         {{ module.code }} {{ module.title }}",
    "Credits        {{ module.credits }}",
    "",
    "Employer       {{ workplace.employer }}",
    "Address        {{ workplace.employerAddress }}",
    "Coach          {{ workplace.coach }}, {{ workplace.coachDesignation }}",
    "Hours          {{ workplace.hours }}",
    "",
    "WHAT WAS DONE",
    "{{ entries }}",
    "",
    "Signed off on  {{ workplace.signedOn }}",
    "Reference      {{ document.reference }}",
    "",
    "",
    "Workplace coach   ____________________________",
  ].join("\n"),
};

/** Every field key a template of this kind may use. */
export function fieldKeysFor(kind: DocumentKind): string[] {
  return DOCUMENT_FIELDS[kind].map((field) => field.key);
}

/**
 * The placeholders a body actually uses, in the order they appear.
 *
 * Deliberately forgiving about spacing - somebody typing `{{learner.fullName}}`
 * and somebody typing `{{ learner.fullName }}` mean the same thing, and a
 * template that silently failed over a space would be maddening to debug.
 */
export function placeholdersIn(body: string): string[] {
  const found: string[] = [];
  const pattern = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
  let match = pattern.exec(body);
  while (match) {
    found.push(match[1]);
    match = pattern.exec(body);
  }
  return found;
}

/**
 * Placeholders the template uses that this kind of document does not have.
 *
 * Reported when a template is saved rather than when one is rendered. A field
 * that does not exist renders as nothing, and a blank space on a learner's
 * certificate is not a failure anybody notices until it is in their hand.
 */
export function unknownPlaceholders(
  kind: DocumentKind,
  body: string,
): string[] {
  const known = new Set(fieldKeysFor(kind));
  return [...new Set(placeholdersIn(body))].filter((key) => !known.has(key));
}
