-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create sequence private.evidence_access_log_id_seq as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;
alter sequence private.evidence_access_log_id_seq owned by private.evidence_access_log.id;
alter sequence private.evidence_access_log_id_seq owner to postgres;
revoke all on sequence private.evidence_access_log_id_seq from public;
create sequence private.frontend_evidence_claim_events_id_seq as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;
alter sequence private.frontend_evidence_claim_events_id_seq owned by private.frontend_evidence_claim_events.id;
alter sequence private.frontend_evidence_claim_events_id_seq owner to postgres;
revoke all on sequence private.frontend_evidence_claim_events_id_seq from public;
create sequence private.moderation_log_id_seq as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;
alter sequence private.moderation_log_id_seq owned by private.moderation_log.id;
alter sequence private.moderation_log_id_seq owner to postgres;
revoke all on sequence private.moderation_log_id_seq from public;
create sequence private.queue_claim_events_id_seq as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;
alter sequence private.queue_claim_events_id_seq owned by private.queue_claim_events.id;
alter sequence private.queue_claim_events_id_seq owner to postgres;
revoke all on sequence private.queue_claim_events_id_seq from public;
create sequence private.queue_claims_id_seq as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;
alter sequence private.queue_claims_id_seq owned by private.queue_claims.id;
alter sequence private.queue_claims_id_seq owner to postgres;
revoke all on sequence private.queue_claims_id_seq from public;
