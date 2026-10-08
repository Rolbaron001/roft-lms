import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organisations, users } from "./tenancy";
import { studyUnits } from "./curriculum";
import { cohortSessions, cohorts } from "./delivery";

/**
 * What a cohort's file holds that the platform does not already keep
 * elsewhere (job sheet D20). Heidi's example folder of 8 October 2026 has a
 * folder per kind: facilitation plans one per lecture, the induction pack,
 * attendance exports from the meeting software, assessor reports per study
 * unit, programme feedback forms, monitoring reports and correspondence with
 * the QCTO. Everything else in that folder already lives on the platform
 * (enrolment documents, evidence, registers, logbooks) and is shown in the
 * cohort file from where it is, not copied here.
 */
export const cohortFileKind = pgEnum("cohort_file_kind", [
  "facilitation_plan",
  "induction_pack",
  "attendance_export",
  "assessor_report",
  "programme_feedback",
  "monitoring_report",
  "correspondence",
  "other",
]);

export const cohortFiles = pgTable(
  "cohort_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id")
      .notNull()
      .references(() => cohorts.id, { onDelete: "cascade" }),
    /** The class session it belongs to: a facilitation plan, an attendance export. */
    sessionId: uuid("session_id").references(() => cohortSessions.id, { onDelete: "set null" }),
    /** The study unit it belongs to: an assessor report, a feedback form. */
    studyUnitId: uuid("study_unit_id").references(() => studyUnits.id, { onDelete: "set null" }),
    kind: cohortFileKind("kind").notNull(),
    title: text("title").notNull(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * When the file left the server in a cohort archive (lib/cohort-archive.ts),
     * and which. Only the archive that takes the cohort's last learners removes
     * these; earlier archives carry a copy.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archiveId: uuid("archive_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cohort_files_cohort_idx").on(t.organisationId, t.cohortId),
    index("cohort_files_session_idx").on(t.sessionId),
  ],
);
