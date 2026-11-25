-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.event_start_within_a_year()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Only a new start is checked: a stored one was within 365 days when set.
  if tg_op='UPDATE' and new.starts_at is not distinct from old.starts_at then return new; end if;
  if new.starts_at>clock_timestamp()+interval '365 days' then
    raise exception 'events can start at most 12 months ahead' using errcode='22023',detail='event_too_far_ahead';
  end if;
  return new;
end;
$function$;
alter function internal.event_start_within_a_year() owner to postgres;
revoke all on function internal.event_start_within_a_year() from public;
