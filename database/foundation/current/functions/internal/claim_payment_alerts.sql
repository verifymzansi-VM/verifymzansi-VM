-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_payment_alerts(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare token uuid := pg_catalog.gen_random_uuid(); claimed jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid payment alert limit' using errcode='22023'; end if;
  -- Marked, not emailed, first seen in the last 7 days and not leased now,
  -- oldest first. Rows another transaction holds are left for the next run.
  with due as (
    select p.id from private.payment_problems p
    where p.needs_alert and p.alerted_at is null
      and p.first_seen_at>clock_timestamp()-interval '7 days'
      and (p.alert_claimed_until is null or p.alert_claimed_until<=clock_timestamp())
    order by p.first_seen_at, p.id
    limit p_limit
    for update skip locked),
  taken as (
    update private.payment_problems p set alert_claim=token,
        alert_claimed_until=clock_timestamp()+interval '5 minutes'
      from due where p.id=due.id
      returning p.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'payment_id',t.payment_id,'reason',t.reason,
      'source',t.source,'first_seen_at',t.first_seen_at,'merchant_reference',pay.merchant_reference,
      'amount_cents',pay.amount_cents::text,'status',pay.status,'fulfillment_status',pay.fulfillment_status,
      'product_kind',pay.product_kind) order by t.first_seen_at, t.id),'[]'::jsonb)
    into claimed
    from taken t join private.payments pay on pay.id=t.payment_id;
  return jsonb_build_object('claim',case when jsonb_array_length(claimed)=0 then null else token end,
    'problems',claimed);
end;
$function$;
alter function internal.claim_payment_alerts(integer) owner to postgres;
revoke all on function internal.claim_payment_alerts(integer) from public;
grant execute on function internal.claim_payment_alerts(integer) to service_role;
