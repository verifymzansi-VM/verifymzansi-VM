-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.ozow_refund_link_candidate(p_refund uuid, p_transaction uuid, p_amount bigint, p_requested_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when count(*) = 1 then min(r.id::text)::uuid end
  from private.payment_refund_requests r
  where p_requested_at is not null
    and r.channel = 'api' and r.status = 'sent' and r.ozow_refund_id is null
    and r.ozow_transaction_id = p_transaction and r.amount_cents = p_amount
    and p_requested_at >= r.sent_at - interval '10 minutes'
    and not exists(select 1 from private.payment_refund_requests x
      where x.ozow_refund_id = p_refund or lower(x.ozow_reference) = p_refund::text);
$function$;
alter function internal.ozow_refund_link_candidate(uuid,uuid,bigint,timestamp with time zone) owner to postgres;
revoke all on function internal.ozow_refund_link_candidate(uuid,uuid,bigint,timestamp with time zone) from public;
