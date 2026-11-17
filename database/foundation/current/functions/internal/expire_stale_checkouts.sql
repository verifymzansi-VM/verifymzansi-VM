-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.expire_stale_checkouts(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare expired integer;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid checkout sweep limit' using errcode='22023'; end if;
  -- Pending for over an hour, no Ozow request, no lease running: no attempt
  -- can still attach a request to it. Rows another transaction holds are
  -- left for the next run.
  with stale as (
    select p.id from private.payments p
    where p.status='pending' and p.provider_request_id is null and p.checkout_url is null
      and p.created_at<clock_timestamp()-interval '1 hour'
      and (p.checkout_claim_until is null or p.checkout_claim_until<=clock_timestamp())
    order by p.created_at, p.id
    limit p_limit
    for update skip locked)
  update private.payments p set status='expired',status_changed_at=clock_timestamp()
    from stale
    where p.id=stale.id and p.status='pending' and p.provider_request_id is null and p.checkout_url is null
      and (p.checkout_claim_until is null or p.checkout_claim_until<=clock_timestamp());
  get diagnostics expired=row_count;
  return expired;
end;
$function$;
alter function internal.expire_stale_checkouts(integer) owner to postgres;
revoke all on function internal.expire_stale_checkouts(integer) from public;
grant execute on function internal.expire_stale_checkouts(integer) to service_role;
