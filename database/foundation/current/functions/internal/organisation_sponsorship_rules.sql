-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.organisation_sponsorship_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare s record; kind text:=case new.programme_status when 'founding_trial' then 'founding'
  when 'active_paid' then 'organisation' end;
begin
  if new.programme_status is distinct from old.programme_status then
    for s in select id from private.organisation_sponsorships where organisation_id=new.id
        and status in('active','waitlisted') and sponsor_type is distinct from kind order by created_at,id loop
      perform internal.finish_sponsorship(s.id,'ended','Programme status changed',null);
    end loop;
  end if;
  perform internal.fill_sponsorship_places(new.id);
  return null;
end;
$function$;
alter function internal.organisation_sponsorship_rules() owner to postgres;
revoke all on function internal.organisation_sponsorship_rules() from public;
