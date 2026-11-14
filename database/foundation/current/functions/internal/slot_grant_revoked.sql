-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_grant_revoked()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.status='revoked' and old.status<>'revoked'
    and (new.slot_id is not null or exists(select 1 from private.entitlements r where r.slot_id=new.id)) then
    perform internal.refresh_slot_chain_documents(coalesce(new.slot_id, new.id));
  end if;
  return null;
end;
$function$;
alter function internal.slot_grant_revoked() owner to postgres;
revoke all on function internal.slot_grant_revoked() from public;
