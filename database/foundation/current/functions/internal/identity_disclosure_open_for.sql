-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_disclosure_open_for(p_disclosure uuid, p_staff uuid)
 RETURNS private.identity_disclosures
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare d private.identity_disclosures;
begin
  select x.* into d from private.identity_disclosures x where x.id=p_disclosure;
  if not found or d.opened_by is distinct from p_staff then
    raise exception 'disclosure unavailable' using errcode='PT409',detail='disclosure_unavailable'; end if;
  if d.closes_at<=clock_timestamp() or exists(select 1 from private.identity_disclosure_events e
      where e.disclosure_id=d.id and e.kind='closed') then
    raise exception 'disclosure closed' using errcode='PT409',detail='disclosure_closed'; end if;
  return d;
end;
$function$;
alter function internal.identity_disclosure_open_for(uuid,uuid) owner to postgres;
revoke all on function internal.identity_disclosure_open_for(uuid,uuid) from public;
