-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_lifecycle_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Ending a run (expired, sold, archived) starts the 3-day deletion clock
  -- once; an event that ends its run earlier still goes at its end. Passing
  -- through paused (the edit flow does this inside one transaction) keeps it.
  if new.status in('expired','sold','archived') then
    if new.ended_at is null then
      new.ended_at:=statement_timestamp();
      new.deletes_at:=case when new.kind='event' and new.deletes_at is not null
        then least(new.deletes_at,new.ended_at+interval '3 days') else new.ended_at+interval '3 days' end;
    else
      new.deletes_at:=coalesce(new.deletes_at,new.ended_at+interval '3 days');
    end if;
  else
    -- Publication or a new submission for review starts a new run.
    if new.status in('live','pending_moderation') then
      new.ended_at:=null;
      delete from private.post_deletion_extensions x where x.post_id=new.id;
    end if;
    -- Outside an ended run only an event has a deletion date: its end (an
    -- edit copy goes with its original).
    if new.ended_at is null then
      new.deletes_at:=case when new.kind='event' and new.edit_of is null
        then (select e.ends_at from private.event_details e where e.post_id=new.id) end;
    end if;
  end if;
  return new;
end$function$;
alter function internal.post_lifecycle_clock() owner to postgres;
revoke all on function internal.post_lifecycle_clock() from public;
