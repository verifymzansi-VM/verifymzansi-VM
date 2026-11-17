-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.organisation_actor(p_org uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();
begin
  if exists(select 1 from private.organisation_admins a where a.organisation_id=p_org and a.account_id=actor)
    and internal.current_verified_identity(actor) is not null then
    return actor;
  end if;
  return internal.staff_actor('organisation:manage');
end;
$function$;
alter function internal.organisation_actor(uuid) owner to postgres;
revoke all on function internal.organisation_actor(uuid) from public;
grant execute on function internal.organisation_actor(uuid) to authenticated;
