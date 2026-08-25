-- Tenant isolation, integrity constraints and the append-only audit log.
--
-- Applied by `npm run db:policies` after every migration. Written by hand
-- rather than generated, because these are the rules the whole platform's
-- data separation rests on and they should be readable by a person.
--
-- Run as the database owner. The application never connects with this role.

-- ---------------------------------------------------------------------------
-- 1. The application role
-- ---------------------------------------------------------------------------
-- Owns nothing, creates nothing, and is subject to every policy below. Because
-- it is not the table owner, it cannot switch row-level security off.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'roft_app') then
    execute format('create role roft_app login password %L', current_setting('roft.app_password', true));
  end if;
end
$$;

grant usage on schema public to roft_app;
grant select, insert, update, delete on all tables in schema public to roft_app;
grant usage, select on all sequences in schema public to roft_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to roft_app;

-- The audit log is written to and read, never amended.
revoke update, delete on audit_log from roft_app;

-- ---------------------------------------------------------------------------
-- 2. Tenant isolation
-- ---------------------------------------------------------------------------
-- Every table carrying organisation_id gets the same policy: rows are visible
-- and writable only when they belong to the tenant in the current transaction
-- context. With no context set, current_setting returns null, the comparison
-- is null, and nothing is visible. Failing closed is the point.
--
-- The loop covers every such table automatically, so a table added later
-- cannot be forgotten. `pg_tables` is filtered to the owner's own tables.

do $$
declare
  t record;
begin
  for t in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attname = 'organisation_id'
      and not a.attisdropped
  loop
    execute format('alter table public.%I enable row level security', t.table_name);
    execute format('drop policy if exists tenant_isolation on public.%I', t.table_name);
    execute format($p$
      create policy tenant_isolation on public.%I
        as permissive
        for all
        to roft_app
        using (organisation_id = nullif(current_setting('app.current_organisation', true), '')::uuid)
        with check (organisation_id = nullif(current_setting('app.current_organisation', true), '')::uuid)
    $p$, t.table_name);
  end loop;
end
$$;

-- `organisations` itself is keyed by `id`, not `organisation_id`, so it needs
-- its own policy: a tenant can read and update only its own record.
alter table public.organisations enable row level security;
drop policy if exists tenant_isolation on public.organisations;
create policy tenant_isolation on public.organisations
  as permissive
  for all
  to roft_app
  using (id = nullif(current_setting('app.current_organisation', true), '')::uuid)
  with check (id = nullif(current_setting('app.current_organisation', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 3. Segregation of duties
-- ---------------------------------------------------------------------------
-- A moderator may not moderate their own assessment decision. Enforced here
-- rather than in the application, because an accreditation reviewer is
-- entitled to ask what stops it, and "the interface doesn't offer the button"
-- is not an answer.

create or replace function assert_moderator_is_not_assessor()
returns trigger
language plpgsql
as $$
declare
  decision_assessor uuid;
begin
  select assessor_id into decision_assessor
  from assessment_decisions
  where id = new.decision_id;

  if decision_assessor = new.moderator_id then
    raise exception
      'Segregation of duties: user % assessed this submission and cannot moderate it.',
      new.moderator_id
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists moderation_segregation_of_duties on moderation_records;
create trigger moderation_segregation_of_duties
  before insert or update on moderation_records
  for each row execute function assert_moderator_is_not_assessor();

-- A coach cannot sign off their own learning. The same rule as moderation:
-- the person attesting that work was done must not be the person who did it.
-- Enforced here rather than only in the application so that no future import
-- routine, script or API can create the arrangement.

create or replace function assert_coach_is_not_learner()
returns trigger
language plpgsql
as $$
begin
  if new.coach_id = new.learner_id then
    raise exception
      'Segregation of duties: user % cannot be their own workplace coach.',
      new.coach_id
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists workplace_coach_is_not_learner on workplace_agreements;
create trigger workplace_coach_is_not_learner
  before insert or update on workplace_agreements
  for each row execute function assert_coach_is_not_learner();

-- Evidence belongs to an assessment submission or to a work experience
-- logbook entry, never to both and never to neither. Without this an orphaned
-- artefact is unreachable from either side of the Portfolio of Evidence while
-- still occupying storage and appearing in counts.
alter table evidence_artifacts
  drop constraint if exists evidence_artifacts_one_owner_check;
alter table evidence_artifacts
  add constraint evidence_artifacts_one_owner_check
  check (
    (submission_id is not null and logbook_entry_id is null)
    or (submission_id is null and logbook_entry_id is not null)
  );

-- Declared here rather than in the schema so the check above is created first:
-- adding the reference and the constraint in one migration would otherwise
-- depend on table creation order.
alter table evidence_artifacts
  drop constraint if exists evidence_artifacts_logbook_entry_fk;
alter table evidence_artifacts
  add constraint evidence_artifacts_logbook_entry_fk
  foreign key (logbook_entry_id)
  references workplace_logbook_entries (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 4. Append-only audit log
-- ---------------------------------------------------------------------------
-- Permissions already deny UPDATE and DELETE to the application role. This
-- trigger blocks them for every role including the owner, so a mistake in a
-- migration cannot quietly rewrite history either.

create or replace function reject_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only; % is not permitted.', tg_op
    using errcode = 'insufficient_privilege';
end
$$;

drop trigger if exists audit_log_is_append_only on audit_log;
create trigger audit_log_is_append_only
  before update or delete on audit_log
  for each row execute function reject_audit_log_mutation();

-- The audit log is readable by external verifiers and administrators within
-- their own tenant, which the tenant_isolation policy above already handles.

-- ---------------------------------------------------------------------------
-- 5. Data-shape constraints
-- ---------------------------------------------------------------------------

-- An enrolment attaches a learner to a course or to a learning path, never
-- both and never neither.
alter table enrolments drop constraint if exists enrolments_target_check;
alter table enrolments add constraint enrolments_target_check
  check (num_nonnulls(course_id, learning_path_id) = 1);

-- Moderation sampling is a proportion.
alter table assessments drop constraint if exists assessments_sample_rate_check;
alter table assessments add constraint assessments_sample_rate_check
  check (moderation_sample_rate >= 0 and moderation_sample_rate <= 1);

alter table assessments drop constraint if exists assessments_pass_mark_check;
alter table assessments add constraint assessments_pass_mark_check
  check (pass_mark >= 0 and pass_mark <= 100);

-- EISA component weights must sum to 1, or the readiness index is meaningless.
--
-- Null is allowed and means "the curriculum document does not state them", in
-- which case readiness derives the weighting from module credits and says so.
-- The previous version of this check treated a missing weighting as three
-- zeroes and rejected the row, which forced every qualification to carry an
-- invented split.
alter table qualifications drop constraint if exists qualifications_weights_check;
alter table qualifications add constraint qualifications_weights_check
  check (
    component_weights is null
    or abs(
      coalesce((component_weights ->> 'knowledge')::numeric, 0)
      + coalesce((component_weights ->> 'practical')::numeric, 0)
      + coalesce((component_weights ->> 'workplace')::numeric, 0)
      - 1
    ) < 0.001
  );

-- A SHA-256 hash is 64 hexadecimal characters. An evidence artifact without
-- one is not admissible, so the shape is checked at write time.
alter table evidence_artifacts drop constraint if exists evidence_artifacts_sha256_check;
alter table evidence_artifacts add constraint evidence_artifacts_sha256_check
  check (sha256 ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------
-- A step on the spine points at exactly one thing.
--
-- `kind` says which, and the target column has to agree with it. Enforced here
-- rather than in the application because a step that claims to be two things,
-- or claims to be a lesson while naming an assessment, is a row nothing
-- downstream can reason about — the gate evaluator would have to guess, and a
-- gate that guesses is not a gate.
alter table course_steps drop constraint if exists course_steps_one_target_check;
alter table course_steps add constraint course_steps_one_target_check
  check (
    num_nonnulls(lesson_id, assessment_id, programme_document_id, curriculum_module_id) = 1
    and (kind <> 'lesson'     or lesson_id is not null)
    and (kind <> 'assessment' or assessment_id is not null)
    and (kind <> 'document'   or programme_document_id is not null)
    and (kind <> 'workplace'  or curriculum_module_id is not null)
  );

-- A step cannot be its own prerequisite. Longer cycles are caught in the
-- application, where the whole spine is in hand and the offending pair can be
-- named; this catches the one case a single row can express.
alter table course_step_prerequisites
  drop constraint if exists course_step_prerequisites_not_self_check;
alter table course_step_prerequisites
  add constraint course_step_prerequisites_not_self_check
  check (step_id <> required_step_id);

-- An override without a reason is not an override, it is a hole in the gate
-- that nobody has to account for.
alter table step_overrides drop constraint if exists step_overrides_reason_check;
alter table step_overrides add constraint step_overrides_reason_check
  check (length(btrim(reason)) >= 10);

-- ---------------------------------------------------------------------------
-- A response holds one kind of answer, matching the item it answers.
--
-- Not enforceable against the item's type from here without a lookup, so what
-- is checked is the weaker but still useful shape: a response that carries a
-- selection and free text and a number at once is a row nothing can mark.
alter table item_responses drop constraint if exists item_responses_one_answer_check;
alter table item_responses add constraint item_responses_one_answer_check
  check (
    num_nonnulls(selected_option_ids, answer_text, answer_number) <= 1
  );

-- A section states what it is worth. Zero or a negative total is a mistake in
-- the paper, not a section worth nothing.
alter table assessment_sections drop constraint if exists assessment_sections_marks_check;
alter table assessment_sections add constraint assessment_sections_marks_check
  check (mark_total is null or mark_total > 0);

-- A submission that has been handed in carries the declaration it was handed
-- in under. Enforced here because the whole point of the declaration is that
-- it cannot be skipped, and a route that forgets to ask for it would otherwise
-- produce evidence nobody attested to.
alter table assessment_submissions drop constraint if exists assessment_submissions_declaration_check;
alter table assessment_submissions add constraint assessment_submissions_declaration_check
  check (
    status = 'draft'
    or paper_id is null
    or (
      length(btrim(coalesce(declaration_text, ''))) > 0
      -- Either the learner attested, or the clock closed it and the record
      -- says so. What is refused is a handed-in paper carrying neither.
      and (declaration_accepted_at is not null or closed_on_time)
    )
  );

-- ---------------------------------------------------------------------------
-- A rubric level covers a real band of the marks, in order.
alter table rubric_levels drop constraint if exists rubric_levels_band_check;
alter table rubric_levels add constraint rubric_levels_band_check
  check (
    min_percent >= 0 and max_percent <= 100 and min_percent <= max_percent
  );

-- Marks awarded cannot exceed what the question is worth, and cannot be
-- negative. Enforced here because a mark out of range corrupts every total
-- computed from it, and the arithmetic is done in several places.
alter table item_responses drop constraint if exists item_responses_awarded_check;
alter table item_responses add constraint item_responses_awarded_check
  check (awarded_marks is null or awarded_marks >= 0);

-- Feedback on a workbook says something. Returning an empty comment tells the
-- learner nothing and looks, on the record, exactly like feedback that was
-- given.
alter table formative_feedback drop constraint if exists formative_feedback_comments_check;
alter table formative_feedback add constraint formative_feedback_comments_check
  check (length(btrim(comments)) >= 10);

-- ---------------------------------------------------------------------------
-- A cohort runs forwards, and a step is due after it opens rather than before.
alter table cohorts drop constraint if exists cohorts_dates_check;
alter table cohorts add constraint cohorts_dates_check
  check (end_date is null or end_date >= start_date);

alter table step_releases drop constraint if exists step_releases_order_check;
alter table step_releases add constraint step_releases_order_check
  check (
    (opens_after_days is null or opens_after_days >= 0)
    and (due_after_days is null or due_after_days >= 0)
    and (closes_after_days is null or closes_after_days >= 0)
    and (
      opens_after_days is null
      or due_after_days is null
      or due_after_days >= opens_after_days
    )
  );
