-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.revoke_organisation_invite(p_invite uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage'); inv private.organisation_invites;
begin
  perform internal.organisation_reason(p_reason);
  update private.organisation_invites set revoked_at=statement_timestamp(),revoked_by=actor
    where id=p_invite and accepted_at is null and revoked_at is null returning * into inv;
  if inv.id is null then raise exception 'open invitation not found' using errcode='PT404',detail='invite_unavailable'; end if;
  perform internal.record_organisation_event(inv.organisation_id,actor,'admin_invite_revoked',inv.id,p_reason);
  return jsonb_build_object('invite_id',inv.id,'revoked',true);
end;
$function$;
alter function internal.revoke_organisation_invite(uuid,text) owner to postgres;
revoke all on function internal.revoke_organisation_invite(uuid,text) from public;
grant execute on function internal.revoke_organisation_invite(uuid,text) to authenticated;
