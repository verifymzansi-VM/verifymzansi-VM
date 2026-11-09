-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_lifecycle_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Publication or a new submission for review starts a new run; a live event
  -- is deleted when it ends. Ending a run starts the 3-day deletion clock once
  -- (an event that ends its run earlier still goes at its end); passing
  -- through paused, draft or rejected (the edit flow does this inside one
  -- transaction) keeps it.
  if new.status in('live','pending_moderation') then
    new.ended_at:=null;
    new.deletes_at:=case when new.kind='event' and new.status='live'
      then (select e.ends_at from private.event_details e where e.post_id=new.id) end;
    delete from private.post_deletion_extensions x where x.post_id=new.id;
  elsif new.status in('expired','sold','archived') then
    if new.ended_at is null then
      new.ended_at:=statement_timestamp();
      new.deletes_at:=case when new.kind='event' and new.deletes_at is not null
        then least(new.deletes_at,new.ended_at+interval '3 days') else new.ended_at+interval '3 days' end;
    else
      new.deletes_at:=coalesce(new.deletes_at,new.ended_at+interval '3 days');
    end if;
  elsif new.status='paused' and new.kind='event' and new.ended_at is null then
    new.deletes_at:=(select e.ends_at from private.event_details e where e.post_id=new.id);
  end if;
  return new;
end$function$;
alter function internal.post_lifecycle_clock() owner to postgres;
revoke all on function internal.post_lifecycle_clock() from public;
