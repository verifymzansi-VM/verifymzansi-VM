-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.purge_expired_identity_bans(p_limit integer)
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
    select b.identity_hmac from private.banned_identities b
    where b.retain_until <= statement_timestamp()
    order by b.retain_until limit p_limit
    for update skip locked
  )
  delete from private.banned_identities b using due where b.identity_hmac = due.identity_hmac;
  get diagnostics n = row_count;
  with due as (select b.decision_id from private.identity_ban_bindings b where b.retain_until<=clock_timestamp() order by b.retain_until limit p_limit for update skip locked)
  delete from private.identity_ban_bindings b using due where b.decision_id=due.decision_id;
  return n;
end;
$function$;
alter function internal.purge_expired_identity_bans(integer) owner to postgres;
revoke all on function internal.purge_expired_identity_bans(integer) from public;
grant execute on function internal.purge_expired_identity_bans(integer) to service_role;
