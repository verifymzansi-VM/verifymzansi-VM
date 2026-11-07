-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.remove_organisation_admin(p_org uuid, p_account uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage');
begin
  perform internal.organisation_reason(p_reason);
  delete from private.organisation_admins where organisation_id=p_org and account_id=p_account;
  if not found then raise exception 'administrator not found' using errcode='PT404',detail='admin_unavailable'; end if;
  perform internal.record_organisation_event(p_org,actor,'admin_removed',p_account,p_reason);
  return jsonb_build_object('removed',true);
end;
$function$;
alter function internal.remove_organisation_admin(uuid,uuid,text) owner to postgres;
revoke all on function internal.remove_organisation_admin(uuid,uuid,text) from public;
grant execute on function internal.remove_organisation_admin(uuid,uuid,text) to authenticated;
