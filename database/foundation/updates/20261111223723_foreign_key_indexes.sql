-- Indexes for foreign keys used by deletion and the clean-up sweeps.
--
-- Postgres does not index the referencing side of a foreign key. When a
-- referenced row is deleted (or its key changes), Postgres looks up the
-- referencing rows of every foreign key that points at it: without a usable
-- index each lookup reads the whole referencing table. This update adds
-- 50 indexes, one per key on a deletion path:
--
-- A. 37 columns that reference auth.users (owner and staff columns). Deleting
--    an Auth user (account deletion, a failed sign-up being undone) checks
--    every one of them, even for a member who never had a row there.
-- B. 9 columns whose parent rows the bounded retention sweep deletes
--    (api.run_retention): decisions and evidence cases
--    (internal.retention_staff_records, internal.retention_verification),
--    identity submissions and evidence files (internal.retention_verification),
--    activations, entitlements and payments (internal.retention_commerce).
-- C. 4 keys to posts, which edits (internal.apply_post_edit,
--    internal.discard_post_edit), deletion (internal.delete_post) and the
--    lifecycle job (internal.run_post_lifecycle) delete, and to the
--    affiliations that cascade from them.
--
-- 40 of these keys were listed by the Supabase performance advisor
-- ("unindexed foreign keys": no index starts with the key's columns). The
-- other 10 have an index that starts with the column but only covers some rows
-- (for example legal_holds_active_idx where released_at is null), so the
-- advisor counts them as indexed while the lookup still reads the table.
--
-- A column that may be null gets a partial index (where the column is not
-- null): the key lookup and every query by value only ever look for a value,
-- and rows without one stay out of the index.
--
-- The other 34 keys the advisor lists are left as they are:
-- - 12 composite keys that an existing index already serves through a unique
--   or selective leading column, such as (post_id, post_kind) on tables whose
--   primary key is post_id, or (case_id, owner_id) next to an index on
--   (case_id, id). A second index would only add write cost.
-- - 19 keys to reference tables that no command deletes or re-keys
--   (provinces, cities, categories, catalogue and plan versions, time zones,
--   posting terms versions).
-- - 3 keys to organisation programmes, which no command deletes.
-- The same holds for keys the advisor counts as indexed whose lookup still
-- reads the table (such as organisation_invites(organisation_id)): their
-- parents are reference rows or organisations, which no command deletes.
--
-- Plain create index, not concurrently: updates run in one transaction, and
-- the tables are tiny today. Each build takes a share lock on its table, which
-- blocks writes to that table (not reads) until the commit; apply it at a
-- quiet time. No function, grant or API command changes, so this update can
-- be applied before or after any website release. Creating or dropping an
-- index does not fire the event trigger internal.require_table_rls (it reacts
-- to table commands only).
--
-- The precondition refuses (55000) when a key or column is missing, when an
-- index already has one of these names with another definition or is invalid,
-- or when another index already serves the key for every row (it starts with
-- the key's first column and has no condition, or only "column is not null").
-- A repeated run changes nothing.
-- Read-only preflight: ../preflight/20261111223723_foreign_key_indexes.check.sql.
-- Rollback: ../rollback/20261111223723_foreign_key_indexes.down.sql.
begin;
-- Never wait more than 5 seconds for a table lock.
set local lock_timeout='5s';

do $$
declare problem text;
begin
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
  )
  select string_agg(p.detail, '; ' order by p.detail) into problem
  from (
    select format('private.%s(%s) is missing', table_name, columns) as detail from w
      where cardinality(attnums) <> width
    union all
    select format('the foreign key on private.%s(%s) is missing', table_name, columns) from w
      where cardinality(attnums) = width and not exists (select 1 from pg_catalog.pg_constraint c
        where c.conrelid = w.rel and c.contype = 'f' and c.conkey = w.attnums)
    union all
    select format('private.%s exists with another definition', index_name) from w
      where named is not null and pg_catalog.pg_get_indexdef(named) is distinct from definition
    union all
    select format('private.%s is invalid; drop it first', index_name) from w
      join pg_catalog.pg_index i on i.indexrelid = w.named where not i.indisvalid
    union all
    select format('private.%s(%s) is already indexed by %s', table_name, columns, i.indexrelid::regclass)
      from w join pg_catalog.pg_index i on i.indrelid = w.rel and i.indkey[0] = w.attnums[1]
      where i.indexrelid is distinct from w.named
        and (i.indpred is null or pg_catalog.pg_get_expr(i.indpred, i.indrelid) = format('(%s IS NOT NULL)', w.first_column))
  ) p;
  if problem is not null then
    raise exception 'foreign key indexes: %', problem using errcode = '55000';
  end if;
end$$;

-- A. Columns that reference auth.users.
create index if not exists accepted_identity_facts_reviewed_by_idx on private.accepted_identity_facts (reviewed_by);
create index if not exists accepted_identity_facts_second_reviewer_idx on private.accepted_identity_facts (second_reviewer) where second_reviewer is not null;
create index if not exists cost_alarms_acknowledged_by_idx on private.cost_alarms (acknowledged_by) where acknowledged_by is not null;
create index if not exists decisions_approved_by_idx on private.decisions (approved_by) where approved_by is not null;
create index if not exists decisions_proposed_by_idx on private.decisions (proposed_by);
create index if not exists decisions_withdrawn_by_idx on private.decisions (withdrawn_by) where withdrawn_by is not null;
create index if not exists entitlement_members_added_by_idx on private.entitlement_members (added_by);
create index if not exists entitlements_granted_by_idx on private.entitlements (granted_by) where granted_by is not null;
create index if not exists entitlements_owner_id_idx on private.entitlements (owner_id);
create index if not exists evidence_access_log_staff_id_idx on private.evidence_access_log (staff_id);
create index if not exists evidence_artifacts_owner_id_idx on private.evidence_artifacts (owner_id);
create index if not exists evidence_cases_claimed_by_idx on private.evidence_cases (claimed_by) where claimed_by is not null;
create index if not exists evidence_fraud_holds_closed_by_idx on private.evidence_fraud_holds (closed_by) where closed_by is not null;
create index if not exists evidence_fraud_holds_placed_by_idx on private.evidence_fraud_holds (placed_by);
create index if not exists frontend_account_restrictions_account_id_idx on private.frontend_account_restrictions (account_id);
create index if not exists frontend_evidence_claim_events_actor_id_idx on private.frontend_evidence_claim_events (actor_id) where actor_id is not null;
create index if not exists frontend_evidence_claim_events_from_staff_idx on private.frontend_evidence_claim_events (from_staff) where from_staff is not null;
create index if not exists frontend_evidence_claim_events_to_staff_idx on private.frontend_evidence_claim_events (to_staff) where to_staff is not null;
create index if not exists identity_ban_proposal_requests_owner_id_idx on private.identity_ban_proposal_requests (owner_id);
create index if not exists legal_holds_placed_by_idx on private.legal_holds (placed_by);
create index if not exists legal_holds_released_by_idx on private.legal_holds (released_by) where released_by is not null;
create index if not exists legal_holds_subject_id_idx on private.legal_holds (subject_id);
create index if not exists media_objects_owner_id_idx on private.media_objects (owner_id);
create index if not exists moderation_log_staff_id_idx on private.moderation_log (staff_id);
create index if not exists payments_owner_id_idx on private.payments (owner_id);
create index if not exists post_activations_owner_id_idx on private.post_activations (owner_id);
create index if not exists queue_claim_events_actor_id_idx on private.queue_claim_events (actor_id);
create index if not exists queue_claim_events_from_staff_idx on private.queue_claim_events (from_staff);
create index if not exists queue_claim_events_to_staff_idx on private.queue_claim_events (to_staff) where to_staff is not null;
create index if not exists reports_reporter_id_idx on private.reports (reporter_id) where reporter_id is not null;
create index if not exists reports_resolved_by_idx on private.reports (resolved_by) where resolved_by is not null;
create index if not exists staff_roles_granted_by_idx on private.staff_roles (granted_by) where granted_by is not null;
create index if not exists staff_roles_revoked_by_idx on private.staff_roles (revoked_by) where revoked_by is not null;
create index if not exists staff_roles_user_id_idx on private.staff_roles (user_id);
create index if not exists trial_identities_owner_id_idx on private.trial_identities (owner_id) where owner_id is not null;
create index if not exists verification_phone_proofs_owner_id_idx on private.verification_phone_proofs (owner_id);
create index if not exists verification_return_requests_reviewer_id_idx on private.verification_return_requests (reviewer_id);

-- B. Columns whose parent rows the retention sweep deletes.
create index if not exists banned_identities_decision_id_idx on private.banned_identities (decision_id);
create index if not exists evidence_access_log_case_id_idx on private.evidence_access_log (case_id);
create index if not exists frontend_verification_uploads_submission_id_idx on private.frontend_verification_uploads (submission_id) where submission_id is not null;
create index if not exists identity_review_proposals_submission_id_idx on private.identity_review_proposals (submission_id);
create index if not exists post_trial_claims_converted_by_activation_id_idx on private.post_trial_claims (converted_by_activation_id) where converted_by_activation_id is not null;
create index if not exists post_trial_claims_trial_entitlement_id_idx on private.post_trial_claims (trial_entitlement_id);
create index if not exists provider_events_payment_id_idx on private.provider_events (payment_id) where payment_id is not null;
create index if not exists verification_identity_submissions_id_artifact_id_idx on private.verification_identity_submissions (id_artifact_id);
create index if not exists verification_identity_submissions_selfie_artifact_id_idx on private.verification_identity_submissions (selfie_artifact_id);

-- C. Keys to posts, and to the affiliations that cascade from them.
create index if not exists organisation_affiliations_post_id_post_kind_idx on private.organisation_affiliations (post_id, post_kind);
create index if not exists organisation_sponsorships_affiliation_id_idx on private.organisation_sponsorships (affiliation_id);
create index if not exists post_activations_post_id_idx on private.post_activations (post_id) where post_id is not null;
create index if not exists reports_post_id_idx on private.reports (post_id) where post_id is not null;

-- Every index above now exists, valid, with exactly this definition.
do $$begin
  if (select count(*) from (values
      ('accepted_identity_facts_reviewed_by_idx', 'CREATE INDEX accepted_identity_facts_reviewed_by_idx ON private.accepted_identity_facts USING btree (reviewed_by)'),
      ('accepted_identity_facts_second_reviewer_idx', 'CREATE INDEX accepted_identity_facts_second_reviewer_idx ON private.accepted_identity_facts USING btree (second_reviewer) WHERE (second_reviewer IS NOT NULL)'),
      ('cost_alarms_acknowledged_by_idx', 'CREATE INDEX cost_alarms_acknowledged_by_idx ON private.cost_alarms USING btree (acknowledged_by) WHERE (acknowledged_by IS NOT NULL)'),
      ('decisions_approved_by_idx', 'CREATE INDEX decisions_approved_by_idx ON private.decisions USING btree (approved_by) WHERE (approved_by IS NOT NULL)'),
      ('decisions_proposed_by_idx', 'CREATE INDEX decisions_proposed_by_idx ON private.decisions USING btree (proposed_by)'),
      ('decisions_withdrawn_by_idx', 'CREATE INDEX decisions_withdrawn_by_idx ON private.decisions USING btree (withdrawn_by) WHERE (withdrawn_by IS NOT NULL)'),
      ('entitlement_members_added_by_idx', 'CREATE INDEX entitlement_members_added_by_idx ON private.entitlement_members USING btree (added_by)'),
      ('entitlements_granted_by_idx', 'CREATE INDEX entitlements_granted_by_idx ON private.entitlements USING btree (granted_by) WHERE (granted_by IS NOT NULL)'),
      ('entitlements_owner_id_idx', 'CREATE INDEX entitlements_owner_id_idx ON private.entitlements USING btree (owner_id)'),
      ('evidence_access_log_staff_id_idx', 'CREATE INDEX evidence_access_log_staff_id_idx ON private.evidence_access_log USING btree (staff_id)'),
      ('evidence_artifacts_owner_id_idx', 'CREATE INDEX evidence_artifacts_owner_id_idx ON private.evidence_artifacts USING btree (owner_id)'),
      ('evidence_cases_claimed_by_idx', 'CREATE INDEX evidence_cases_claimed_by_idx ON private.evidence_cases USING btree (claimed_by) WHERE (claimed_by IS NOT NULL)'),
      ('evidence_fraud_holds_closed_by_idx', 'CREATE INDEX evidence_fraud_holds_closed_by_idx ON private.evidence_fraud_holds USING btree (closed_by) WHERE (closed_by IS NOT NULL)'),
      ('evidence_fraud_holds_placed_by_idx', 'CREATE INDEX evidence_fraud_holds_placed_by_idx ON private.evidence_fraud_holds USING btree (placed_by)'),
      ('frontend_account_restrictions_account_id_idx', 'CREATE INDEX frontend_account_restrictions_account_id_idx ON private.frontend_account_restrictions USING btree (account_id)'),
      ('frontend_evidence_claim_events_actor_id_idx', 'CREATE INDEX frontend_evidence_claim_events_actor_id_idx ON private.frontend_evidence_claim_events USING btree (actor_id) WHERE (actor_id IS NOT NULL)'),
      ('frontend_evidence_claim_events_from_staff_idx', 'CREATE INDEX frontend_evidence_claim_events_from_staff_idx ON private.frontend_evidence_claim_events USING btree (from_staff) WHERE (from_staff IS NOT NULL)'),
      ('frontend_evidence_claim_events_to_staff_idx', 'CREATE INDEX frontend_evidence_claim_events_to_staff_idx ON private.frontend_evidence_claim_events USING btree (to_staff) WHERE (to_staff IS NOT NULL)'),
      ('identity_ban_proposal_requests_owner_id_idx', 'CREATE INDEX identity_ban_proposal_requests_owner_id_idx ON private.identity_ban_proposal_requests USING btree (owner_id)'),
      ('legal_holds_placed_by_idx', 'CREATE INDEX legal_holds_placed_by_idx ON private.legal_holds USING btree (placed_by)'),
      ('legal_holds_released_by_idx', 'CREATE INDEX legal_holds_released_by_idx ON private.legal_holds USING btree (released_by) WHERE (released_by IS NOT NULL)'),
      ('legal_holds_subject_id_idx', 'CREATE INDEX legal_holds_subject_id_idx ON private.legal_holds USING btree (subject_id)'),
      ('media_objects_owner_id_idx', 'CREATE INDEX media_objects_owner_id_idx ON private.media_objects USING btree (owner_id)'),
      ('moderation_log_staff_id_idx', 'CREATE INDEX moderation_log_staff_id_idx ON private.moderation_log USING btree (staff_id)'),
      ('payments_owner_id_idx', 'CREATE INDEX payments_owner_id_idx ON private.payments USING btree (owner_id)'),
      ('post_activations_owner_id_idx', 'CREATE INDEX post_activations_owner_id_idx ON private.post_activations USING btree (owner_id)'),
      ('queue_claim_events_actor_id_idx', 'CREATE INDEX queue_claim_events_actor_id_idx ON private.queue_claim_events USING btree (actor_id)'),
      ('queue_claim_events_from_staff_idx', 'CREATE INDEX queue_claim_events_from_staff_idx ON private.queue_claim_events USING btree (from_staff)'),
      ('queue_claim_events_to_staff_idx', 'CREATE INDEX queue_claim_events_to_staff_idx ON private.queue_claim_events USING btree (to_staff) WHERE (to_staff IS NOT NULL)'),
      ('reports_reporter_id_idx', 'CREATE INDEX reports_reporter_id_idx ON private.reports USING btree (reporter_id) WHERE (reporter_id IS NOT NULL)'),
      ('reports_resolved_by_idx', 'CREATE INDEX reports_resolved_by_idx ON private.reports USING btree (resolved_by) WHERE (resolved_by IS NOT NULL)'),
      ('staff_roles_granted_by_idx', 'CREATE INDEX staff_roles_granted_by_idx ON private.staff_roles USING btree (granted_by) WHERE (granted_by IS NOT NULL)'),
      ('staff_roles_revoked_by_idx', 'CREATE INDEX staff_roles_revoked_by_idx ON private.staff_roles USING btree (revoked_by) WHERE (revoked_by IS NOT NULL)'),
      ('staff_roles_user_id_idx', 'CREATE INDEX staff_roles_user_id_idx ON private.staff_roles USING btree (user_id)'),
      ('trial_identities_owner_id_idx', 'CREATE INDEX trial_identities_owner_id_idx ON private.trial_identities USING btree (owner_id) WHERE (owner_id IS NOT NULL)'),
      ('verification_phone_proofs_owner_id_idx', 'CREATE INDEX verification_phone_proofs_owner_id_idx ON private.verification_phone_proofs USING btree (owner_id)'),
      ('verification_return_requests_reviewer_id_idx', 'CREATE INDEX verification_return_requests_reviewer_id_idx ON private.verification_return_requests USING btree (reviewer_id)'),
      ('banned_identities_decision_id_idx', 'CREATE INDEX banned_identities_decision_id_idx ON private.banned_identities USING btree (decision_id)'),
      ('evidence_access_log_case_id_idx', 'CREATE INDEX evidence_access_log_case_id_idx ON private.evidence_access_log USING btree (case_id)'),
      ('frontend_verification_uploads_submission_id_idx', 'CREATE INDEX frontend_verification_uploads_submission_id_idx ON private.frontend_verification_uploads USING btree (submission_id) WHERE (submission_id IS NOT NULL)'),
      ('identity_review_proposals_submission_id_idx', 'CREATE INDEX identity_review_proposals_submission_id_idx ON private.identity_review_proposals USING btree (submission_id)'),
      ('post_trial_claims_converted_by_activation_id_idx', 'CREATE INDEX post_trial_claims_converted_by_activation_id_idx ON private.post_trial_claims USING btree (converted_by_activation_id) WHERE (converted_by_activation_id IS NOT NULL)'),
      ('post_trial_claims_trial_entitlement_id_idx', 'CREATE INDEX post_trial_claims_trial_entitlement_id_idx ON private.post_trial_claims USING btree (trial_entitlement_id)'),
      ('provider_events_payment_id_idx', 'CREATE INDEX provider_events_payment_id_idx ON private.provider_events USING btree (payment_id) WHERE (payment_id IS NOT NULL)'),
      ('verification_identity_submissions_id_artifact_id_idx', 'CREATE INDEX verification_identity_submissions_id_artifact_id_idx ON private.verification_identity_submissions USING btree (id_artifact_id)'),
      ('verification_identity_submissions_selfie_artifact_id_idx', 'CREATE INDEX verification_identity_submissions_selfie_artifact_id_idx ON private.verification_identity_submissions USING btree (selfie_artifact_id)'),
      ('organisation_affiliations_post_id_post_kind_idx', 'CREATE INDEX organisation_affiliations_post_id_post_kind_idx ON private.organisation_affiliations USING btree (post_id, post_kind)'),
      ('organisation_sponsorships_affiliation_id_idx', 'CREATE INDEX organisation_sponsorships_affiliation_id_idx ON private.organisation_sponsorships USING btree (affiliation_id)'),
      ('post_activations_post_id_idx', 'CREATE INDEX post_activations_post_id_idx ON private.post_activations USING btree (post_id) WHERE (post_id IS NOT NULL)'),
      ('reports_post_id_idx', 'CREATE INDEX reports_post_id_idx ON private.reports USING btree (post_id) WHERE (post_id IS NOT NULL)')
    ) d(index_name, definition)
    join pg_catalog.pg_index i on i.indexrelid = to_regclass('private.' || d.index_name)
    where i.indisvalid and pg_catalog.pg_get_indexdef(i.indexrelid) = d.definition) <> 50 then
    raise exception 'foreign key indexes were not all created' using errcode = '55000';
  end if;
end$$;
commit;
