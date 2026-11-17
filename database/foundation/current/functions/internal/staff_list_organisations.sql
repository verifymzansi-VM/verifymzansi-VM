-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_list_organisations()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'slug',o.slug,'name',o.name,
      'programme_status',o.programme_status,'is_public',o.is_public,'revision',o.revision,'updated_at',o.updated_at)
    order by o.name),'[]') from (select * from private.organisations order by name limit 500) o);
end;
$function$;
alter function internal.staff_list_organisations() owner to postgres;
revoke all on function internal.staff_list_organisations() from public;
grant execute on function internal.staff_list_organisations() to authenticated;
