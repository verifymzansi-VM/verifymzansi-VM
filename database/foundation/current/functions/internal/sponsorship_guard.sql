-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.sponsorship_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.organisation_id,new.affiliation_id,new.post_id,new.owner_id,new.sponsor_type,new.requested_by,new.created_at)
      is distinct from (old.id,old.organisation_id,old.affiliation_id,old.post_id,old.owner_id,old.sponsor_type,
        old.requested_by,old.created_at)
    or old.status in('ended','revoked')
    or (old.status='active' and new.status='waitlisted')
    or (old.entitlement_id is not null and new.entitlement_id is distinct from old.entitlement_id) then
    raise exception 'sponsorship history is immutable' using errcode='23514'; end if;
  return new;
end;
$function$;
alter function internal.sponsorship_guard() owner to postgres;
revoke all on function internal.sponsorship_guard() from public;
