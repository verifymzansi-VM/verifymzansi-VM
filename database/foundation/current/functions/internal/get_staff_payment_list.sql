-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_payment_list(p_page integer, p_filter text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb; attention bigint; waiting bigint;
begin
  actor := internal.staff_actor('payments:view');
  if p_page is null or p_page not between 1 and 100000 or (p_filter is not null and p_filter not in (
      'pending','processing','complete','failed','cancelled','expired','refunded','chargeback',
      'needs_attention','awaiting_approval')) then
    raise exception 'valid payment filter required' using errcode='22023';
  end if;
  select count(*) into attention from private.payments p
    where p.status = 'complete' and p.fulfillment_status = 'needs_reconciliation';
  select count(*) into waiting from private.payment_refund_requests r where r.status = 'awaiting_approval';
  with listed as (
    select x.* from private.payments x
    where case p_filter
      when 'needs_attention' then x.status = 'complete' and x.fulfillment_status = 'needs_reconciliation'
      when 'awaiting_approval' then exists(select 1 from private.payment_refund_requests r
        where r.payment_id = x.id and r.status = 'awaiting_approval')
      else p_filter is null or x.status = p_filter end
  )
  select jsonb_build_object('total', (select count(*) from listed), 'page', p_page,
    'needs_attention', attention, 'awaiting_approval', waiting,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'user_id', p.owner_id, 'status', p.status, 'fulfillment_status', p.fulfillment_status,
      'product_kind', p.product_kind, 'amount_cents', p.amount_cents, 'created_at', p.created_at,
      'completed_at', p.completed_at, 'merchant_reference', p.merchant_reference,
      'area', coalesce(p.snapshot->>'area', p.snapshot->>'target_area', 'all'),
      'description', coalesce(p.snapshot->>'label', initcap(p.snapshot->>'addon')||' add-on', 'Payment'),
      'reversed', exists(select 1 from private.frontend_payment_reversals v where v.payment_id = p.id)
        or p.status in ('refunded', 'chargeback'),
      'activated_at', (select a.created_at from private.payment_activations a where a.payment_id = p.id),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'line_number', l.line_number,
          'amount_cents', l.amount_cents, 'status', l.status, 'reversal_kind', l.reversal_kind) order by l.line_number)
        from private.payment_lines l where l.payment_id = p.id), '[]'::jsonb),
      'refund_request', (select jsonb_build_object('id', r.id, 'line_id', r.payment_line_id, 'kind', r.kind,
          'reason_code', r.reason_code, 'amount_cents', r.amount_cents, 'ozow_reference', r.ozow_reference,
          'requested_at', r.requested_at, 'requested_by_me', internal.same_identity(r.requested_by, actor))
        from private.payment_refund_requests r where r.payment_id = p.id and r.status = 'awaiting_approval'))
      order by p.created_at desc, p.id desc), '[]'::jsonb))
    into result
  from (select * from listed order by created_at desc, id desc limit 50 offset (p_page-1)*50) p;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_payment_list(integer,text) owner to postgres;
revoke all on function internal.get_staff_payment_list(integer,text) from public;
grant execute on function internal.get_staff_payment_list(integer,text) to authenticated;
