-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.event_deletion_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  update private.posts p set deletes_at=new.ends_at
    where p.id=new.post_id and p.kind='event' and p.status in('live','paused') and p.ended_at is null
      and p.deletes_at is distinct from new.ends_at;
  return null;
end$function$;
alter function internal.event_deletion_clock() owner to postgres;
revoke all on function internal.event_deletion_clock() from public;
