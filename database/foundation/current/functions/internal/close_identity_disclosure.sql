-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.close_identity_disclosure(p_disclosure uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('identity:disclose'); d private.identity_disclosures;
begin
  select x.* into d from private.identity_disclosures x where x.id=p_disclosure;
  if not found or d.opened_by is distinct from actor then
    raise exception 'disclosure unavailable' using errcode='PT409',detail='disclosure_unavailable'; end if;
  if d.closes_at>clock_timestamp() and not exists(select 1 from private.identity_disclosure_events e
      where e.disclosure_id=d.id and e.kind='closed') then
    insert into private.identity_disclosure_events(disclosure_id,staff_id,kind) values(d.id,actor,'closed');
  end if;
  return jsonb_build_object('disclosure_id',d.id,'closed',true);
end;
$function$;
alter function internal.close_identity_disclosure(uuid) owner to postgres;
revoke all on function internal.close_identity_disclosure(uuid) from public;
grant execute on function internal.close_identity_disclosure(uuid) to authenticated;
