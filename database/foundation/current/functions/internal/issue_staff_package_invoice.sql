-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.issue_staff_package_invoice(p_request_id uuid, p_due_days integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; r private.package_invoice_requests; plan private.plan_versions; made private.customer_invoices;
begin
  actor := internal.staff_actor('payments:refund');
  if p_due_days is null or p_due_days not between 1 and 30 then
    raise exception 'days to pay required (1 to 30)' using errcode='22023', detail='invoice_issue_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  r := internal.lock_package_invoice_request(p_request_id, actor, 'payments:refund');
  -- The same staff member repeating the same step gets the first answer.
  if r.status in ('awaiting_approval', 'issued') and r.prepared_by = actor and r.due_days = p_due_days
      and r.staff_reason = btrim(p_reason) then
    return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('invoice',
      (select internal.customer_invoice_dto(i, actor) from private.customer_invoices i where i.id = r.invoice_id),
      'repeated', true);
  end if;
  if r.status <> 'requested' then
    raise exception 'this invoice request is already %', replace(r.status, '_', ' ')
      using errcode='PT409', detail='package_invoice_request_closed';
  end if;
  plan := internal.package_invoice_issue_check(r);
  if r.total_cents > internal.package_invoice_approval_above_cents() then
    -- Above R50,000 a second staff member approves it first; no number yet.
    update private.package_invoice_requests set status = 'awaiting_approval', prepared_by = actor,
        prepared_at = statement_timestamp(), due_days = p_due_days, staff_reason = btrim(p_reason)
      where id = r.id returning * into r;
  else
    made := internal.issue_package_customer_invoice(r, plan, actor, p_due_days, btrim(p_reason));
    update private.package_invoice_requests set status = 'issued', prepared_by = actor,
        prepared_at = statement_timestamp(), due_days = p_due_days, staff_reason = btrim(p_reason), invoice_id = made.id
      where id = r.id returning * into r;
  end if;
  if internal.staff_actor('payments:refund') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  perform internal.assert_staff_payment_actor(actor, r.account_id);
  return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('invoice',
    case when made.id is null then null else internal.customer_invoice_dto(made, actor) end, 'repeated', false);
end;
$function$;
alter function internal.issue_staff_package_invoice(uuid,integer,text) owner to postgres;
revoke all on function internal.issue_staff_package_invoice(uuid,integer,text) from public;
grant execute on function internal.issue_staff_package_invoice(uuid,integer,text) to authenticated;
