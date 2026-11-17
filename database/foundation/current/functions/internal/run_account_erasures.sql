-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.run_account_erasures(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare candidate record; outcome jsonb; erased integer := 0; held integer := 0; failed integer := 0;
  removed integer := 0; kept integer := 0; purged integer := 0; stuck integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode = '22023'; end if;
  -- Due erasures, each on its own: a failure is recorded and retried after an hour.
  for candidate in
    select e.user_id from private.account_erasures e
    where e.erased_at is null and e.erase_after <= statement_timestamp()
      and (e.blocked_at is null or e.blocked_at < statement_timestamp() - interval '1 hour')
    order by e.erase_after limit p_limit
    for update skip locked
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.user_id::text, 2408)) then
      continue;
    end if;
    begin
      outcome := internal.erase_closed_account(candidate.user_id, 'sweep');
      if outcome->>'status' in ('erased', 'removed') then erased := erased + 1; else held := held + 1; end if;
    exception when others then
      failed := failed + 1;
      update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = 'error',
          blocked_detail = sqlstate
        where user_id = candidate.user_id;
    end;
  end loop;
  -- Erased accounts whose Auth user is still named by a kept record: checked once a day.
  for candidate in
    select e.user_id from private.account_erasures e
    where e.erased_at is not null and e.auth_removed_at is null
      and (e.auth_checked_at is null or e.auth_checked_at < statement_timestamp() - interval '1 day')
    order by e.auth_checked_at nulls first, e.erased_at limit p_limit
    for update skip locked
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.user_id::text, 2408)) then
      continue;
    end if;
    begin
      if internal.remove_erased_auth_user(candidate.user_id) then
        update private.account_erasures set auth_removed_at = statement_timestamp(),
            auth_checked_at = statement_timestamp(), blocked_at = null, blocked_reason = null, blocked_detail = null
          where user_id = candidate.user_id;
        removed := removed + 1;
      else
        update private.account_erasures set auth_checked_at = statement_timestamp() where user_id = candidate.user_id;
        kept := kept + 1;
      end if;
    exception when others then
      failed := failed + 1;
      update private.account_erasures set auth_checked_at = statement_timestamp(), blocked_at = statement_timestamp(),
          blocked_reason = 'error', blocked_detail = sqlstate
        where user_id = candidate.user_id;
    end;
  end loop;
  -- The proof of an erasure: kept 5 years, once the Auth user is gone.
  begin
    delete from private.account_erasures e where e.user_id in (select x.user_id from private.account_erasures x
      where x.auth_removed_at is not null and x.erased_at < statement_timestamp() - interval '5 years'
      order by x.erased_at limit p_limit for update skip locked);
    get diagnostics purged = row_count;
  exception when others then
    failed := failed + 1;
  end;
  -- Erasures that failed: the retention job raises an alert while any remain.
  select count(*) into stuck from private.account_erasures e where e.blocked_reason = 'error';
  return jsonb_build_object('erased', erased, 'held', held, 'failed', failed, 'auth_removed', removed,
    'auth_kept', kept, 'records_purged', purged, 'stuck', stuck);
end;
$function$;
alter function internal.run_account_erasures(integer) owner to postgres;
revoke all on function internal.run_account_erasures(integer) from public;
