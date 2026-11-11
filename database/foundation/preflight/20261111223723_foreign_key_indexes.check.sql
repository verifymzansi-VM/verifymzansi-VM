-- Read-only preflight for updates/20261111223723_foreign_key_indexes.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: it is one query, and the
-- first statement makes the transaction read only, so when the file runs as
-- one transaction (as the SQL editor runs it) Postgres refuses any write. The
-- result has one "summary" row, then one row per problem. Apply the update
-- only when the summary is the only row.
--
-- The summary says how many of the 50 indexes exist and are valid (none
-- before the update, all after it) and the total size of the tables they are
-- built on, which is what the build has to read while it holds each table's
-- share lock (writes to that table wait; reads do not). A problem row names a
-- missing column or foreign key, an index that has one of the update's names
-- with another definition or is invalid, or another index that already serves
-- the key for every row (the update would then add a duplicate); the update
-- refuses in each case. The update changes no function or API command, so it
-- can be applied before or after any website release.
do $$begin
  set transaction read only;
end$$;
with wanted(table_name, columns, partial) as (values
  ('accepted_identity_facts', 'reviewed_by', false),
  ('accepted_identity_facts', 'second_reviewer', true),
  ('cost_alarms', 'acknowledged_by', true),
  ('decisions', 'approved_by', true),
  ('decisions', 'proposed_by', false),
  ('decisions', 'withdrawn_by', true),
  ('entitlement_members', 'added_by', false),
  ('entitlements', 'granted_by', true),
  ('entitlements', 'owner_id', false),
  ('evidence_access_log', 'staff_id', false),
  ('evidence_artifacts', 'owner_id', false),
  ('evidence_cases', 'claimed_by', true),
  ('evidence_fraud_holds', 'closed_by', true),
  ('evidence_fraud_holds', 'placed_by', false),
  ('frontend_account_restrictions', 'account_id', false),
  ('frontend_evidence_claim_events', 'actor_id', true),
  ('frontend_evidence_claim_events', 'from_staff', true),
  ('frontend_evidence_claim_events', 'to_staff', true),
  ('identity_ban_proposal_requests', 'owner_id', false),
  ('legal_holds', 'placed_by', false),
  ('legal_holds', 'released_by', true),
  ('legal_holds', 'subject_id', false),
  ('media_objects', 'owner_id', false),
  ('moderation_log', 'staff_id', false),
  ('payments', 'owner_id', false),
  ('post_activations', 'owner_id', false),
  ('queue_claim_events', 'actor_id', false),
  ('queue_claim_events', 'from_staff', false),
  ('queue_claim_events', 'to_staff', true),
  ('reports', 'reporter_id', true),
  ('reports', 'resolved_by', true),
  ('staff_roles', 'granted_by', true),
  ('staff_roles', 'revoked_by', true),
  ('staff_roles', 'user_id', false),
  ('trial_identities', 'owner_id', true),
  ('verification_phone_proofs', 'owner_id', false),
  ('verification_return_requests', 'reviewer_id', false),
  ('banned_identities', 'decision_id', false),
  ('evidence_access_log', 'case_id', false),
  ('frontend_verification_uploads', 'submission_id', true),
  ('identity_review_proposals', 'submission_id', false),
  ('post_trial_claims', 'converted_by_activation_id', true),
  ('post_trial_claims', 'trial_entitlement_id', false),
  ('provider_events', 'payment_id', true),
  ('verification_identity_submissions', 'id_artifact_id', false),
  ('verification_identity_submissions', 'selfie_artifact_id', false),
  ('organisation_affiliations', 'post_id, post_kind', false),
  ('organisation_sponsorships', 'affiliation_id', false),
  ('post_activations', 'post_id', true),
  ('reports', 'post_id', true)
),
w as (
  select w.table_name, w.columns,
    format('%s_%s_idx', w.table_name, replace(w.columns, ', ', '_')) as index_name,
    format('CREATE INDEX %s_%s_idx ON private.%s USING btree (%s)%s', w.table_name, replace(w.columns, ', ', '_'),
      w.table_name, w.columns, case when w.partial then format(' WHERE (%s IS NOT NULL)', w.columns) else '' end) as definition,
    to_regclass(format('private.%I', w.table_name)) as rel,
    array(select a.attnum from unnest(string_to_array(w.columns, ', ')) with ordinality c(name, o)
      join pg_catalog.pg_attribute a on a.attrelid = to_regclass(format('private.%I', w.table_name))
        and a.attname = c.name and not a.attisdropped order by c.o)::smallint[] as attnums,
    cardinality(string_to_array(w.columns, ', ')) as width,
    split_part(w.columns, ', ', 1) as first_column,
    to_regclass(format('private.%I', format('%s_%s_idx', w.table_name, replace(w.columns, ', ', '_')))) as named
  from wanted w
),
present as (
  select count(*) as n from w join pg_catalog.pg_index i on i.indexrelid = w.named
  where i.indisvalid and pg_catalog.pg_get_indexdef(i.indexrelid) = w.definition
),
problems as (
  select 'problem' as kind, format('private.%s(%s) is missing', table_name, columns) as detail
    from w where cardinality(attnums) <> width
  union all
  select 'problem', format('the foreign key on private.%s(%s) is missing', table_name, columns) from w
    where cardinality(attnums) = width and not exists (select 1 from pg_catalog.pg_constraint c
      where c.conrelid = w.rel and c.contype = 'f' and c.conkey = w.attnums)
  union all
  select 'problem', format('private.%s exists with another definition: %s', index_name,
      coalesce(pg_catalog.pg_get_indexdef(named), 'not an index')) from w
    where named is not null and pg_catalog.pg_get_indexdef(named) is distinct from definition
  union all
  select 'problem', format('private.%s is invalid; drop it before applying the update', index_name) from w
    join pg_catalog.pg_index i on i.indexrelid = w.named where not i.indisvalid
  union all
  select 'problem', format('private.%s(%s) is already indexed by %s; do not apply the update',
      table_name, columns, i.indexrelid::regclass)
    from w join pg_catalog.pg_index i on i.indrelid = w.rel and i.indkey[0] = w.attnums[1]
    where i.indexrelid is distinct from w.named
      and (i.indpred is null or pg_catalog.pg_get_expr(i.indpred, i.indrelid) = format('(%s IS NOT NULL)', w.first_column))
)
select 'summary' as kind,
  'foreign key indexes: '
    || case (select n from present)
         when 50 then 'already applied'
         when 0 then 'not applied (can be applied before or after the website release)'
         else 'partly applied' end
    || '; present ' || (select n from present)
    || ' of 50; size of the '
    || (select count(distinct rel) from w where rel is not null) || ' tables: '
    || pg_catalog.pg_size_pretty((select coalesce(sum(pg_catalog.pg_table_size(r)), 0)
         from (select distinct rel as r from w where rel is not null) t)) as detail
union all
select kind, detail from problems;
