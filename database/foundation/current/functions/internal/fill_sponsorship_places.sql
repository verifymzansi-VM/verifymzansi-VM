-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.fill_sponsorship_places(p_org uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare o private.organisations; used integer; next_id uuid; started integer:=0;
begin
  select * into o from private.organisations where id=p_org;
  if not found or o.programme_status not in('founding_trial','active_paid') then return 0; end if;
  loop
    select count(*) into used from private.organisation_sponsorships where organisation_id=p_org and status='active';
    exit when used>=o.sponsored_capacity;
    select id into next_id from private.organisation_sponsorships where organisation_id=p_org and status='waitlisted'
      order by created_at,id limit 1;
    exit when next_id is null;
    if internal.start_sponsorship(next_id) then started:=started+1; end if;
  end loop;
  return started;
end;
$function$;
alter function internal.fill_sponsorship_places(uuid) owner to postgres;
revoke all on function internal.fill_sponsorship_places(uuid) from public;
