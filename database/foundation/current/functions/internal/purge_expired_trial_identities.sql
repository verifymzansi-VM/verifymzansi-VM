-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.purge_expired_trial_identities(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  with due as (
    select t.identity_hmac from private.trial_identities t
    where t.retain_until <= statement_timestamp()
    order by t.retain_until limit p_limit
    for update skip locked
  )
  delete from private.trial_identities t using due where t.identity_hmac = due.identity_hmac;
  get diagnostics n = row_count;
  return n;
end;
$function$;
alter function internal.purge_expired_trial_identities(integer) owner to postgres;
revoke all on function internal.purge_expired_trial_identities(integer) from public;
grant execute on function internal.purge_expired_trial_identities(integer) to service_role;
