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
alter table qualifications drop constraint if exists qualifications_weights_check;
alter table qualifications add constraint qualifications_weights_check
  check (
    abs(
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
