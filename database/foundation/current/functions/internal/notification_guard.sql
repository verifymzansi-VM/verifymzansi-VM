-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.notification_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.account_id,new.kind,new.subject_id,new.post_id,new.organisation_id,new.created_at)
      is distinct from (old.id,old.account_id,old.kind,old.subject_id,old.post_id,old.organisation_id,old.created_at)
    or (old.read_at is not null and new.read_at is distinct from old.read_at) then
    raise exception 'notifications are immutable except first read' using errcode='23514'; end if;
  return new;
end;
$function$;
alter function internal.notification_guard() owner to postgres;
revoke all on function internal.notification_guard() from public;
