import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Deployment mode per Section 5 of the design document. The same containers run
 * in all three; this column records which one a tenant is contracted for.
 */
export const deploymentMode = pgEnum("deployment_mode", [
  "shared_cloud",
  "dedicated_cloud",
  "on_premise",
]);

export const tenantStatus = pgEnum("tenant_status", [
  "provisioning",
  "active",
  "suspended",
  "closed",
]);

/**
 * The seven roles from Section 3 of the design document, plus the two the QCTO
 * framework requires: Skills Development Facilitator (drives WSP/ATR reporting)
 * and External Verifier (read-only audit access for a SETA, AQP or the QCTO).
 * A user may hold several.
 */
export const userRole = pgEnum("user_role", [
  "platform_owner",
  "tenant_admin",
  "instructor",
  "assessor",
  "moderator",
  "line_manager",
  "learner",
  "skills_development_facilitator",
  "external_verifier",
]);

export const userStatus = pgEnum("user_status", [
  "invited",
  "active",
  "suspended",
  "anonymised",
]);

/**
 * A tenant: one client business or learning centre. Everything else in the
 * schema hangs off this, and every query is scoped to it by row-level security.
 */
export const organisations = pgTable(
  "organisations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    deploymentMode: deploymentMode("deployment_mode")
      .notNull()
      .default("shared_cloud"),
    status: tenantStatus("status").notNull().default("provisioning"),

    // White-labelling. Injected as CSS custom properties at request time so a
    // tenant's own identity renders without a separate build or deployment.
    logoUrl: text("logo_url"),
    primaryColour: text("primary_colour").notNull().default("#0D1E32"),
    accentColour: text("accent_colour").notNull().default("#B9975B"),
    customDomain: text("custom_domain"),

    /**
     * Which modules this tenant sees. An internal corporate client gets the
     * training modules only; an accredited Skills Development Provider also
     * gets the QCTO portfolio-of-evidence and statutory reporting modules.
     * Read through lib/features.ts rather than touched directly.
     */
    featureFlags: jsonb("feature_flags")
      .notNull()
      .$type<Record<string, boolean>>()
      .default({}),

    // QCTO / SAQA provider identity, used by the NLRD Provider Record export.
    accreditationNumber: text("accreditation_number"),
    wardCode: text("ward_code"),
    physicalAddress: jsonb("physical_address").$type<{
      line1?: string;
      line2?: string;
      city?: string;
      province?: string;
      postalCode?: string;
      country?: string;
    }>(),
    qualityAssurancePartner: text("quality_assurance_partner"),

    /**
     * Statutory retention window. Personal identifiers may be anonymised on
     * request once this has elapsed; achievement records are kept permanently.
     */
    dataRetentionYears: integer("data_retention_years").notNull().default(5),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("organisations_slug_idx").on(t.slug),
    uniqueIndex("organisations_custom_domain_idx").on(t.customDomain),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    status: userStatus("status").notNull().default("invited"),

    // Workforce placement, used for reporting by team, site and role.
    jobTitle: text("job_title"),
    team: text("team"),
    site: text("site"),
    lineManagerId: uuid("line_manager_id"),

    /**
     * OFO code (Organising Framework for Occupations). Required for WSP/ATR
     * returns and for benchmarking a role against an occupational standard.
     */
    ofoCode: text("ofo_code"),

    /**
     * Demographic fields required by the NLRD Person Record. Held separately
     * from achievement data so they can be anonymised under POPIA without
     * destroying the academic record.
     */
    nationalId: text("national_id"),
    dateOfBirth: timestamp("date_of_birth", { withTimezone: false }),
    gender: text("gender"),
    equityCode: text("equity_code"),
    disabilityCode: text("disability_code"),
    nationality: text("nationality"),

    // POPIA consent, captured at onboarding.
    consentGivenAt: timestamp("consent_given_at", { withTimezone: true }),
    consentVersion: text("consent_version"),

    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Email is unique within a tenant, not across the platform: the same person
    // may legitimately hold accounts at two client businesses.
    uniqueIndex("users_org_email_idx").on(t.organisationId, t.email),
    index("users_org_idx").on(t.organisationId),
    index("users_line_manager_idx").on(t.lineManagerId),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRole("role").notNull(),

    /**
     * Registration number with the relevant body, for an assessor or moderator
     * whose standing has to be verifiable at audit. The NLRD Achievement Record
     * export validates that this is present and current.
     */
    registrationNumber: text("registration_number"),
    registrationExpiresAt: timestamp("registration_expires_at", {
      withTimezone: true,
    }),

    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("user_roles_unique_idx").on(t.userId, t.role),
    index("user_roles_org_idx").on(t.organisationId),
  ],
);

/**
 * Append-only. Nothing in the application updates or deletes from this table,
 * and a database trigger enforces that, because an audit trail an administrator
 * can quietly edit is not an audit trail.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    actorId: uuid("actor_id"),
    actorRole: userRole("actor_role"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_org_time_idx").on(t.organisationId, t.occurredAt),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
  ],
);

/**
 * Competency frameworks, per Section 4.6. A course that is not tagged to a
 * competency cannot be reported on as capability coverage, which is the whole
 * point of the platform, so tagging happens at authoring time.
 */
export const competencyFrameworks = pgTable(
  "competency_frameworks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    version: text("version").notNull().default("1.0"),
    /** Where this came from: ROFT advisory work, the client's own model, or an
     * external standard such as ESCO, O*NET or OFO. */
    source: text("source"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("competency_frameworks_org_idx").on(t.organisationId)],
);

export const competencies = pgTable(
  "competencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    frameworkId: uuid("framework_id")
      .notNull()
      .references(() => competencyFrameworks.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Named proficiency levels, ordered lowest to highest. */
    proficiencyLevels: jsonb("proficiency_levels")
      .notNull()
      .$type<string[]>()
      .default([]),
    externalReference: text("external_reference"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("competencies_framework_code_idx").on(t.frameworkId, t.code),
    index("competencies_org_idx").on(t.organisationId),
  ],
);
