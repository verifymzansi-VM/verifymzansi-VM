-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_organisation_detail(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare detail jsonb;
begin
  perform internal.staff_actor('organisation:manage');
  detail:=internal.staff_get_organisation(p_id);
  if detail is null then return null;end if;
  -- No applicant contacts: staff ask for one pending application's contact
  -- with api.reveal_organisation_applicant_contact, which is logged.
  perform internal.staff_actor('organisation:manage');
  return detail;
end$function$;
alter function internal.get_frontend_staff_organisation_detail(uuid) owner to postgres;
revoke all on function internal.get_frontend_staff_organisation_detail(uuid) from public;
grant execute on function internal.get_frontend_staff_organisation_detail(uuid) to authenticated;
