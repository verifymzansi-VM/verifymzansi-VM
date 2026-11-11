-- Read-only preflight for updates/20261111223723_foreign_key_indexes.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary says how many of the 39 indexes exist (none before the
-- update, all after it) and the total size of the tables they are built on,
-- which is what the build has to read while it holds each table's share lock
-- (writes to that table wait; reads do not). A problem row names a missing
-- column or foreign key, an index that has one of the update's names with
-- another definition, or another index that already starts with the column
-- (the update would then add a duplicate); the update refuses in each case.
-- The update changes no function or API command, so it can be applied before
-- or after any website release.
do $$begin
  set transaction read only;
end$$;
with wanted(table_name, column_name, partial) as (values
    ('accepted_identity_facts', 'reviewed_by', false),
    ('accepted_identity_facts', 'second_reviewer', true),
    ('cost_alarms', 'acknowledged_by', true),
    ('decisions', 'approved_by', true),
    ('decisions', 'proposed_by', false),
    ('decisions', 'withdrawn_by', true),
    ('entitlement_members', 'added_by', false),
    ('entitlements', 'granted_by', true),
    ('evidence_access_log', 'staff_id', false),
    ('evidence_artifacts', 'owner_id', false),
    ('evidence_cases', 'claimed_by', true),
    ('evidence_fraud_holds', 'closed_by', true),
    ('evidence_fraud_holds', 'placed_by', false),
    ('frontend_evidence_claim_events', 'actor_id', true),
    ('frontend_evidence_claim_events', 'from_staff', true),
    ('frontend_evidence_claim_events', 'to_staff', true),
    ('identity_ban_proposal_requests', 'owner_id', false),
    ('legal_holds', 'placed_by', false),
    ('legal_holds', 'released_by', true),
    ('moderation_log', 'staff_id', false),
    ('post_activations', 'owner_id', false),
    ('queue_claim_events', 'actor_id', false),
    ('queue_claim_events', 'from_staff', false),
    ('queue_claim_events', 'to_staff', true),
    ('reports', 'reporter_id', true),
    ('reports', 'resolved_by', true),
    ('staff_roles', 'granted_by', true),
    ('staff_roles', 'revoked_by', true),
    ('trial_identities', 'owner_id', true),
    ('verification_return_requests', 'reviewer_id', false),
    ('banned_identities', 'decision_id', false),
    ('evidence_access_log', 'case_id', false),
    ('frontend_verification_uploads', 'submission_id', true),
    ('identity_review_proposals', 'submission_id', false),
    ('post_trial_claims', 'converted_by_activation_id', true),
    ('post_trial_claims', 'trial_entitlement_id', false),
    ('provider_events', 'payment_id', true),
    ('verification_identity_submissions', 'id_artifact_id', false),
    ('verification_identity_submissions', 'selfie_artifact_id', false)
),
w as (
  select w.table_name, w.column_name,
    format('%s_%s_idx', w.table_name, w.column_name) as index_name,
    format('CREATE INDEX %s_%s_idx ON private.%s USING btree (%s)%s', w.table_name, w.column_name,
      w.table_name, w.column_name, case when w.partial then format(' WHERE (%s IS NOT NULL)', w.column_name) else '' end) as definition,
    to_regclass(format('private.%I', w.table_name)) as rel, a.attnum,
    to_regclass(format('private.%I', format('%s_%s_idx', w.table_name, w.column_name))) as named
  from wanted w
  left join pg_catalog.pg_attribute a
    on a.attrelid = to_regclass(format('private.%I', w.table_name)) and a.attname = w.column_name and not a.attisdropped
),
problems as (
  select 'problem' as kind, format('private.%s.%s is missing', table_name, column_name) as detail
    from w where attnum is null
  union all
  select 'problem', format('the foreign key on private.%s(%s) is missing', table_name, column_name) from w
    where attnum is not null and not exists (select 1 from pg_catalog.pg_constraint c
      where c.conrelid = w.rel and c.contype = 'f' and c.conkey = array[w.attnum])
  union all
  select 'problem', format('private.%s exists with another definition: %s', index_name,
      coalesce(pg_catalog.pg_get_indexdef(named), 'not an index')) from w
    where named is not null and pg_catalog.pg_get_indexdef(named) is distinct from definition
  union all
  select 'problem', format('private.%s(%s) is already indexed by %s; do not apply the update',
      table_name, column_name, i.indexrelid::regclass)
    from w join pg_catalog.pg_index i on i.indrelid = w.rel and i.indkey[0] = w.attnum
    where i.indexrelid is distinct from w.named
)
select 'summary' as kind,
  'foreign key indexes: '
    || case (select count(*) from w where pg_catalog.pg_get_indexdef(named) = definition)
         when 39 then 'already applied'
         when 0 then 'not applied (can be applied before or after the website release)'
         else 'partly applied' end
    || '; present ' || (select count(*) from w where pg_catalog.pg_get_indexdef(named) = definition)
    || ' of 39; size of the '
    || (select count(distinct rel) from w where rel is not null) || ' tables: '
    || pg_catalog.pg_size_pretty((select coalesce(sum(pg_catalog.pg_table_size(r)), 0)
         from (select distinct rel as r from w where rel is not null) t)) as detail
union all
select kind, detail from problems;
