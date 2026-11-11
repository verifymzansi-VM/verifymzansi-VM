-- Rollback for updates/20261111223723_foreign_key_indexes.sql.
--
-- Drops exactly the 50 indexes the update created, and nothing else. It
-- refuses (55000) when an index with one of these names has another
-- definition, because then it is not the update's index. Each drop takes an
-- access exclusive lock on its table (reads and writes wait) and holds it
-- until the commit; the tables are small and the 5-second lock timeout makes
-- the whole rollback fail rather than queue behind a long transaction. Run it
-- at a quiet time. Running it again, or before the update was applied,
-- changes nothing. Only performance changes: no function, grant or API
-- command depends on these indexes.
begin;
set local lock_timeout='5s';

do $$
declare problem text;
begin
  select string_agg(format('private.%s has another definition', d.index_name), '; ' order by d.index_name)
    into problem
  from (values
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
  where to_regclass('private.' || d.index_name) is not null
    and pg_catalog.pg_get_indexdef(to_regclass('private.' || d.index_name)) is distinct from d.definition;
  if problem is not null then
    raise exception 'foreign key index rollback refused: %', problem using errcode = '55000';
  end if;
end$$;

drop index if exists private.accepted_identity_facts_reviewed_by_idx;
drop index if exists private.accepted_identity_facts_second_reviewer_idx;
drop index if exists private.cost_alarms_acknowledged_by_idx;
drop index if exists private.decisions_approved_by_idx;
drop index if exists private.decisions_proposed_by_idx;
drop index if exists private.decisions_withdrawn_by_idx;
drop index if exists private.entitlement_members_added_by_idx;
drop index if exists private.entitlements_granted_by_idx;
drop index if exists private.entitlements_owner_id_idx;
drop index if exists private.evidence_access_log_staff_id_idx;
drop index if exists private.evidence_artifacts_owner_id_idx;
drop index if exists private.evidence_cases_claimed_by_idx;
drop index if exists private.evidence_fraud_holds_closed_by_idx;
drop index if exists private.evidence_fraud_holds_placed_by_idx;
drop index if exists private.frontend_account_restrictions_account_id_idx;
drop index if exists private.frontend_evidence_claim_events_actor_id_idx;
drop index if exists private.frontend_evidence_claim_events_from_staff_idx;
drop index if exists private.frontend_evidence_claim_events_to_staff_idx;
drop index if exists private.identity_ban_proposal_requests_owner_id_idx;
drop index if exists private.legal_holds_placed_by_idx;
drop index if exists private.legal_holds_released_by_idx;
drop index if exists private.legal_holds_subject_id_idx;
drop index if exists private.media_objects_owner_id_idx;
drop index if exists private.moderation_log_staff_id_idx;
drop index if exists private.payments_owner_id_idx;
drop index if exists private.post_activations_owner_id_idx;
drop index if exists private.queue_claim_events_actor_id_idx;
drop index if exists private.queue_claim_events_from_staff_idx;
drop index if exists private.queue_claim_events_to_staff_idx;
drop index if exists private.reports_reporter_id_idx;
drop index if exists private.reports_resolved_by_idx;
drop index if exists private.staff_roles_granted_by_idx;
drop index if exists private.staff_roles_revoked_by_idx;
drop index if exists private.staff_roles_user_id_idx;
drop index if exists private.trial_identities_owner_id_idx;
drop index if exists private.verification_phone_proofs_owner_id_idx;
drop index if exists private.verification_return_requests_reviewer_id_idx;
drop index if exists private.banned_identities_decision_id_idx;
drop index if exists private.evidence_access_log_case_id_idx;
drop index if exists private.frontend_verification_uploads_submission_id_idx;
drop index if exists private.identity_review_proposals_submission_id_idx;
drop index if exists private.post_trial_claims_converted_by_activation_id_idx;
drop index if exists private.post_trial_claims_trial_entitlement_id_idx;
drop index if exists private.provider_events_payment_id_idx;
drop index if exists private.verification_identity_submissions_id_artifact_id_idx;
drop index if exists private.verification_identity_submissions_selfie_artifact_id_idx;
drop index if exists private.organisation_affiliations_post_id_post_kind_idx;
drop index if exists private.organisation_sponsorships_affiliation_id_idx;
drop index if exists private.post_activations_post_id_idx;
drop index if exists private.reports_post_id_idx;

commit;
