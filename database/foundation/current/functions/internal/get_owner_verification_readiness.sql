-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_owner_verification_readiness()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  with facts as materialized (
    select internal.current_verified_identity(actor) is not null as verified,
      exists(select 1 from private.verification_phone_proofs p
        where p.owner_id=actor and p.revoked_at is null) as phone,
      exists(select 1 from private.verification_localities l
        where l.owner_id=actor) as locality
  )
  select jsonb_build_object(
    'verification_ready',f.verified and f.phone and f.locality,
    'phone_verified',f.phone,'locality_confirmed',f.locality
  ) into result from facts f;
  -- Canonical readiness is VOLATILE; the conservative conjunction guarantees
  -- the DTO implication even across concurrent proof transitions. It is a
  -- current observation, never permission for a later submit command.
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_owner_verification_readiness() owner to postgres;
revoke all on function internal.get_owner_verification_readiness() from public;
grant execute on function internal.get_owner_verification_readiness() to authenticated;
