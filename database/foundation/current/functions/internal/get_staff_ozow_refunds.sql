-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_ozow_refunds(p_payment_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  if p_payment_ids is null or cardinality(p_payment_ids) > 50 or array_position(p_payment_ids, null) is not null then
    raise exception 'up to 50 payments required' using errcode='22023';
  end if;
  select jsonb_build_object(
    'payments', coalesce((select jsonb_agg(jsonb_build_object('payment_id', p.id,
        'ozow_refundable', p.status = 'complete' and internal.ozow_refund_transaction(p.id) is not null) order by p.id)
      from private.payments p where p.id = any(p_payment_ids)), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(internal.staff_ozow_refund_view(r, actor) order by r.requested_at, r.id)
      from private.payment_refund_requests r
      where r.payment_id = any(p_payment_ids) and r.channel in ('api', 'dashboard')), '[]'::jsonb),
    'attention', coalesce((select jsonb_agg(internal.staff_ozow_refund_view(a, actor) order by a.requested_at, a.id)
      from (select r.* from private.payment_refund_requests r
        where r.channel = 'api' and (
          (r.status in ('failed', 'returned') and coalesce(r.failed_at, r.returned_at) > statement_timestamp() - interval '30 days'
            and not exists(select 1 from private.payment_refund_requests n where n.payment_id = r.payment_id
              and n.requested_at > r.requested_at and n.status in ('awaiting_approval', 'approved', 'sent', 'applied')))
          or (r.status = 'approved' and r.approved_at < statement_timestamp() - interval '1 day')
          or (r.status = 'sent' and r.sent_at < statement_timestamp() - interval '1 day'))
        order by r.requested_at, r.id limit 20) a), '[]'::jsonb))
    into result;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_ozow_refunds(uuid[]) owner to postgres;
revoke all on function internal.get_staff_ozow_refunds(uuid[]) from public;
grant execute on function internal.get_staff_ozow_refunds(uuid[]) to authenticated;
