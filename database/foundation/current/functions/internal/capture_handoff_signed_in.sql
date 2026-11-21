-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.capture_handoff_signed_in(p_handoff private.capture_handoffs, p_signed_in uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_signed_in is null then
    raise exception 'sign in on this phone with the same account' using errcode='42501',detail='handoff_sign_in_required'; end if;
  if p_signed_in<>p_handoff.owner_id then
    raise exception 'signed in as another account' using errcode='42501',detail='handoff_other_account'; end if;
end;
$function$;
alter function internal.capture_handoff_signed_in(private.capture_handoffs,uuid) owner to postgres;
revoke all on function internal.capture_handoff_signed_in(private.capture_handoffs,uuid) from public;
