-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_slot_limit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- An erasure unlinks the erased account from this kept record (20261116175757_close_and_erase_account.sql);
  -- nothing else may change with it.
  if tg_op = 'UPDATE' and coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> '' then
    if internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['account_id']) then
      return new;
    end if;
  end if;
  -- The retention sweep deletes a raise 2 years after it ended.
  if tg_op = 'DELETE' and pg_catalog.current_setting('vm.retention', true) = 'on' then
    return old;
  end if;
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
