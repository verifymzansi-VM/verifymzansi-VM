-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_list_programme_showcases(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'programme_id',s.programme_id,'title',s.title,
      'placement',s.placement,'enabled',s.enabled,'starts_at',s.starts_at,'ends_at',s.ends_at,'max_cards',s.max_cards,
      'province',s.province_id,'city',s.city_id,'display_order',s.display_order,'sponsored_only',s.sponsored_only,
      'revision',s.revision,'updated_at',s.updated_at) order by s.display_order,s.created_at),'[]')
    from private.programme_showcases s where s.organisation_id=p_org);
end;
$function$;
alter function internal.staff_list_programme_showcases(uuid) owner to postgres;
revoke all on function internal.staff_list_programme_showcases(uuid) from public;
grant execute on function internal.staff_list_programme_showcases(uuid) to authenticated;
