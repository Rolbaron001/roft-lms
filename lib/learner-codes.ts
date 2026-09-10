/**
 * The QCTO's own code lists for a learner enrolment return.
 *
 * Taken verbatim from `Design/Templates/data-loading-specification-document.pdf`,
 * which is the authority: these are not the platform's categories and are not
 * open to improvement. A return carrying `Male` where the specification says
 * `M`, or `1` where it says `01`, is rejected on upload - and rejected as a
 * whole file, so one wrong cell costs the entire cohort's submission.
 *
 * Several of them read oddly to a modern eye. `05 = Intellectual (difficulties
 * in learning); retardation` is the specification's own wording; the label
 * below softens the term for the screen while the **code** stays exactly as the
 * QCTO defines it, because the code is what is submitted and the label is only
 * what a person reads.
 *
 * Pure on purpose: no imports, no database. The enrolment form needs these
 * lists in the browser, and anything reaching into the database here would drag
 * the Postgres driver into the bundle with it.
 */

export type CodeOption = { code: string; label: string };

/** Column F. */
export const EQUITY_CODES: CodeOption[] = [
  { code: "BA", label: "Black African" },
  { code: "BC", label: "Coloured" },
  { code: "BI", label: "Indian / Asian" },
  { code: "Wh", label: "White" },
  { code: "Oth", label: "Other" },
  { code: "U", label: "Unknown" },
];

/** Column G. Abbreviated to the countries the specification names. */
export const NATIONALITY_CODES: CodeOption[] = [
  { code: "SA", label: "South Africa" },
  { code: "SDC", label: "SADC, except South Africa" },
  { code: "NAM", label: "Namibia" },
  { code: "BOT", label: "Botswana" },
  { code: "ZIM", label: "Zimbabwe" },
  { code: "ANG", label: "Angola" },
  { code: "MOZ", label: "Mozambique" },
  { code: "LES", label: "Lesotho" },
  { code: "SWA", label: "Eswatini" },
  { code: "MAL", label: "Malawi" },
  { code: "ZAM", label: "Zambia" },
  { code: "MAU", label: "Mauritius" },
  { code: "TAN", label: "Tanzania" },
  { code: "SEY", label: "Seychelles" },
  { code: "ZAI", label: "Democratic Republic of the Congo" },
  { code: "ROA", label: "Rest of Africa" },
  { code: "EUR", label: "European countries" },
  { code: "AIS", label: "Asian countries" },
  { code: "NOR", label: "North American countries" },
  { code: "SOU", label: "Central and South American countries" },
  { code: "AUS", label: "Australia and Oceania" },
  { code: "OOC", label: "Other and rest of Oceania" },
  { code: "NOT", label: "Not applicable: institution" },
  { code: "U", label: "Unspecified" },
];

/** Column H. The eleven official languages, plus sign language and other. */
export const HOME_LANGUAGE_CODES: CodeOption[] = [
  { code: "Afr", label: "Afrikaans" },
  { code: "Eng", label: "English" },
  { code: "Nde", label: "isiNdebele" },
  { code: "Xho", label: "isiXhosa" },
  { code: "Zul", label: "isiZulu" },
  { code: "Sep", label: "Sepedi (Northern Sotho)" },
  { code: "Ses", label: "Sesotho" },
  { code: "Set", label: "Setswana" },
  { code: "Swa", label: "siSwati" },
  { code: "Tsh", label: "Tshivenda" },
  { code: "Xit", label: "Xitsonga" },
  { code: "SASL", label: "South African Sign Language" },
  { code: "Oth", label: "Other" },
];

/** Column I. */
export const GENDER_CODES: CodeOption[] = [
  { code: "F", label: "Female" },
  { code: "M", label: "Male" },
];

/** Column J. */
export const CITIZEN_RESIDENT_CODES: CodeOption[] = [
  { code: "SA", label: "South African" },
  { code: "PR", label: "Permanent resident" },
  { code: "D", label: "Dual: South African and other" },
  { code: "O", label: "Other" },
  { code: "U", label: "Unknown" },
];

/** Column K. */
export const SOCIOECONOMIC_CODES: CodeOption[] = [
  { code: "01", label: "Employed" },
  { code: "02", label: "Unemployed, looking for work" },
  { code: "03", label: "Not working, not looking for work" },
  { code: "04", label: "Home-maker, not working" },
  { code: "06", label: "Scholar or student, not working" },
  { code: "07", label: "Pensioner or retired, not working" },
  { code: "08", label: "Not working, disabled person" },
  { code: "09", label: "Not working, not wishing to work" },
  { code: "10", label: "Not working, not elsewhere classified" },
  { code: "97", label: "Not applicable: under 15" },
  { code: "98", label: "Not applicable: institution" },
  { code: "U", label: "Unspecified" },
];

/**
 * Column L. `N` means none; every other code is a kind of difficulty and
 * obliges a rating in column M.
 */
export const DISABILITY_STATUS_CODES: CodeOption[] = [
  { code: "N", label: "None" },
  { code: "01", label: "Sight, even with glasses" },
  { code: "02", label: "Hearing, even with a hearing aid" },
  { code: "03", label: "Communication: talking, listening" },
  { code: "04", label: "Physical: moving, standing, grasping" },
  { code: "05", label: "Intellectual: difficulties in learning" },
  { code: "06", label: "Emotional: behavioural or psychological" },
  { code: "07", label: "Multiple" },
  { code: "09", label: "Disabled but unspecified" },
];

/** Column M. */
export const DISABILITY_RATING_CODES: CodeOption[] = [
  { code: "01", label: "No difficulty" },
  { code: "02", label: "Some difficulty" },
  { code: "03", label: "A lot of difficulty" },
  { code: "04", label: "Cannot do at all" },
  { code: "06", label: "Cannot yet be determined" },
  { code: "60", label: "May be part of multiple difficulties" },
  { code: "70", label: "May have difficulty" },
  { code: "80", label: "Former difficulty, none now" },
];

/** Column N. */
export const IMMIGRANT_STATUS_CODES: CodeOption[] = [
  { code: "03", label: "South African citizen" },
  { code: "01", label: "Immigrant" },
  { code: "02", label: "Refugee" },
];

/** Column AF. */
export const PROVINCE_CODES: CodeOption[] = [
  { code: "1", label: "Western Cape" },
  { code: "2", label: "Eastern Cape" },
  { code: "3", label: "Northern Cape" },
  { code: "4", label: "Free State" },
  { code: "5", label: "KwaZulu-Natal" },
  { code: "6", label: "North West" },
  { code: "7", label: "Gauteng" },
  { code: "8", label: "Mpumalanga" },
  { code: "9", label: "Limpopo" },
  { code: "N", label: "In South Africa, province unspecified" },
  { code: "X", label: "Outside South Africa" },
];

/**
 * Column E. What kind of document a learner without a South African identity
 * number is enrolled on.
 *
 * Not a coded list in the specification, which asks only for the type as text.
 * These are the three the enrolment form itself offers, so the platform records
 * one of them rather than free text nobody can report on.
 */
export const ALTERNATE_ID_TYPES: CodeOption[] = [
  { code: "passport", label: "Passport" },
  { code: "work_permit", label: "Work permit" },
  { code: "asylum_permit", label: "Asylum or refugee permit" },
];

export const CODE_LISTS = {
  equityCode: EQUITY_CODES,
  nationalityCode: NATIONALITY_CODES,
  homeLanguageCode: HOME_LANGUAGE_CODES,
  genderCode: GENDER_CODES,
  citizenResidentStatusCode: CITIZEN_RESIDENT_CODES,
  socioeconomicStatusCode: SOCIOECONOMIC_CODES,
  disabilityStatusCode: DISABILITY_STATUS_CODES,
  disabilityRating: DISABILITY_RATING_CODES,
  immigrantStatus: IMMIGRANT_STATUS_CODES,
  provinceCode: PROVINCE_CODES,
  alternateIdType: ALTERNATE_ID_TYPES,
} as const;

export type CodedField = keyof typeof CODE_LISTS;

/** Whether a value is one the QCTO will accept for that field. */
export function isValidCode(field: CodedField, value: string): boolean {
  return CODE_LISTS[field].some((option) => option.code === value);
}

/** The label for a code, or the code itself where it is not one we know. */
export function labelFor(field: CodedField, value: string): string {
  return (
    CODE_LISTS[field].find((option) => option.code === value)?.label ?? value
  );
}

/**
 * A disability rating is required once a difficulty is recorded.
 *
 * The specification's own condition on column M: "This field will contain data
 * if code 01 to 09 is selected in the Disability Status Code field." `N`, which
 * means none, is the only status that leaves the rating empty.
 */
export function ratingRequiredFor(disabilityStatusCode: string): boolean {
  return disabilityStatusCode.trim() !== "" && disabilityStatusCode !== "N";
}

/**
 * Fields the QCTO writes as text but a spreadsheet reads as a number.
 *
 * `01` is not `1`. Excel drops the leading zero the moment the cell is anything
 * but text, and the QCTO's loader then rejects the file. Heidi raised this
 * specifically on 9 September as the thing that makes their submissions manual.
 *
 * The export writes these with a leading apostrophe, which is Excel's own way
 * of saying "this is text, leave it alone".
 */
export const LEADING_ZERO_FIELDS: readonly CodedField[] = [
  "socioeconomicStatusCode",
  "disabilityStatusCode",
  "disabilityRating",
  "immigrantStatus",
] as const;

/**
 * A value as it must appear in the QCTO's spreadsheet.
 *
 * Anything that could be read as a number, and whose leading zero matters, is
 * prefixed so the cell stays text. Everything else is written as it is.
 */
export function forSpreadsheet(field: CodedField, value: string): string {
  if (!value) return "";
  const needsQuoting =
    LEADING_ZERO_FIELDS.includes(field) && /^0\d/.test(value);
  return needsQuoting ? `'${value}` : value;
}
