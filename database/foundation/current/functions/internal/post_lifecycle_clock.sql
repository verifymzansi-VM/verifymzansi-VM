-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_lifecycle_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Publication or a new submission for review starts a new run. Ending a run
  -- starts the deletion clock once; passing through paused, draft or rejected
  -- (the edit flow does this inside one transaction) keeps it.
  if new.status in('live','pending_moderation') then
    new.ended_at:=null;new.deletes_at:=null;
  elsif new.status in('expired','sold','archived') then
    new.ended_at:=coalesce(new.ended_at,statement_timestamp());
    new.deletes_at:=coalesce(new.deletes_at,new.ended_at+interval '30 days');
  end if;
  return new;
end$function$;
alter function internal.post_lifecycle_clock() owner to postgres;
revoke all on function internal.post_lifecycle_clock() from public;
