-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_slot_limit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- The audit trail of raised limits: a raise is only ever ended, once.
  if tg_op = 'DELETE' then
    raise exception 'slot limit history is retained' using errcode='23514';
  end if;
  if (to_jsonb(new) - array['revoked_at','revoked_by','revoke_reason'])
      is distinct from (to_jsonb(old) - array['revoked_at','revoked_by','revoke_reason'])
    or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'slot limit history is immutable; end the raise and grant a new one' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.individual_slot_limit_guard() owner to postgres;
revoke all on function internal.individual_slot_limit_guard() from public;
