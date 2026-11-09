-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.event_submission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op='UPDATE' then
    -- The only change: an owner's deletion returns the place, once.
    if old.released_at is null and new.released_at is not null
      and (new.id,new.owner_id,new.post_id,new.submitted_at) is not distinct from (old.id,old.owner_id,old.post_id,old.submitted_at) then
      return new;
    end if;
  elsif old.submitted_at<=clock_timestamp()-interval '30 days'
    or not exists(select 1 from auth.users u where u.id=old.owner_id) then
    return old; -- outside every rolling window, or removed with its erased account
  end if;
  raise exception 'event submissions are append-only' using errcode='23514';
end$function$;
alter function internal.event_submission_guard() owner to postgres;
revoke all on function internal.event_submission_guard() from public;
