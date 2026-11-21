-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.capture_handoff_state(p_handoff private.capture_handoffs)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'owner_id',p_handoff.owner_id,
    'expires_at',p_handoff.expires_at,
    'public_name',coalesce(internal.profile_public_name(
      (select p.display_name from private.profiles p where p.account_id=p_handoff.owner_id)),'Member'),
    'needs_id',p_handoff.fingerprint is not null and not exists(
      select 1 from private.frontend_verification_uploads r where r.owner_id=p_handoff.owner_id
        and r.case_id=p_handoff.case_id and r.purpose='id_front' and r.completed_at is not null
        and r.created_at>=p_handoff.created_at),
    'needs_selfie',not exists(
      select 1 from private.frontend_verification_uploads r where r.owner_id=p_handoff.owner_id
        and r.case_id=p_handoff.case_id and r.purpose='selfie' and r.completed_at is not null
        and r.created_at>=p_handoff.created_at));
$function$;
alter function internal.capture_handoff_state(private.capture_handoffs) owner to postgres;
revoke all on function internal.capture_handoff_state(private.capture_handoffs) from public;
