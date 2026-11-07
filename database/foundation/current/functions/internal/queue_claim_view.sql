-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.queue_claim_view(p_claim private.queue_claims)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('subject', case when p_claim.post_id is not null then 'post' else 'report' end,
    'id', coalesce(p_claim.post_id, p_claim.report_id),
    'claim_generation', p_claim.claim_generation::text, 'claim_nonce', p_claim.claim_nonce,
    'claim_expires_at', p_claim.claim_expires_at, 'renewals_left', 4 - p_claim.renewals,
    'revision', (select p.revision from private.posts p where p.id = p_claim.post_id),
    'edit_of', (select p.edit_of from private.posts p where p.id = p_claim.post_id));
$function$;
alter function internal.queue_claim_view(private.queue_claims) owner to postgres;
revoke all on function internal.queue_claim_view(private.queue_claims) from public;
