-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.affiliation_sponsorship_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare s record; freed boolean:=false;
begin
  perform 1 from private.organisations o where o.id=new.organisation_id for update;
  for s in select id from private.organisation_sponsorships where affiliation_id=new.id
      and status in('active','waitlisted') loop
    freed:=internal.finish_sponsorship(s.id,'revoked','Affiliation ended',new.revoked_by) or freed;
  end loop;
  if freed then perform internal.fill_sponsorship_places(new.organisation_id); end if;
  return null;
end;
$function$;
alter function internal.affiliation_sponsorship_rules() owner to postgres;
revoke all on function internal.affiliation_sponsorship_rules() from public;
