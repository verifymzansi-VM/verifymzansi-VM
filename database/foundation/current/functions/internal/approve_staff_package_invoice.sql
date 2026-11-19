-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.approve_staff_package_invoice(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; r private.package_invoice_requests; plan private.plan_versions; made private.customer_invoices;
begin
  actor := internal.staff_actor('payments:confirm_transfer');
  r := internal.lock_package_invoice_request(p_request_id, actor, 'payments:confirm_transfer');
  if r.status = 'issued' and r.approved_by = actor then
    return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('invoice',
      (select internal.customer_invoice_dto(i, actor) from private.customer_invoices i where i.id = r.invoice_id),
      'repeated', true);
  end if;
  if r.status <> 'awaiting_approval' then
    raise exception 'this invoice request is %; only a prepared invoice above R50,000 is approved', replace(r.status, '_', ' ')
      using errcode='PT409', detail='package_invoice_request_closed';
  end if;
  -- Two people: never the staff member who prepared it (or another account of
  -- their identity), who must still hold the authority to issue invoices and
  -- must not have come to refer the customer.
  if internal.same_identity(actor, r.prepared_by) then
    raise exception 'a different staff member must approve this invoice' using errcode='42501', detail='invoice_approver_same';
  end if;
  if not exists(select 1 from private.staff_roles s join private.staff_capabilities c on c.role = s.role
      where s.user_id = r.prepared_by and s.revoked_at is null and c.capability = 'payments:refund')
    or not exists(select 1 from private.current_account_access a where a.id = r.prepared_by) then
    raise exception 'the staff member who prepared this invoice can no longer issue invoices; decline it'
      using errcode='PT409', detail='invoice_preparer_inactive';
  end if;
  -- ...and must still have a current accepted ID review of their own and
  -- never be the customer's identity.
  if internal.current_verified_identity(r.prepared_by) is null
      or internal.same_identity(r.prepared_by, r.account_id) then
    raise exception 'the staff member who prepared this invoice can no longer issue invoices; decline it'
      using errcode='PT409', detail='invoice_preparer_inactive';
  end if;
  perform internal.assert_staff_not_referrer(r.prepared_by, r.account_id);
  plan := internal.package_invoice_issue_check(r);
  made := internal.issue_package_customer_invoice(r, plan, r.prepared_by, r.due_days, r.staff_reason);
  update private.package_invoice_requests set status = 'issued', approved_by = actor, approved_at = statement_timestamp(),
      invoice_id = made.id
    where id = r.id returning * into r;
  if internal.staff_actor('payments:confirm_transfer') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  perform internal.assert_staff_payment_actor(actor, r.account_id);
  return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('invoice',
    internal.customer_invoice_dto(made, actor), 'repeated', false);
end;
$function$;
alter function internal.approve_staff_package_invoice(uuid) owner to postgres;
revoke all on function internal.approve_staff_package_invoice(uuid) from public;
grant execute on function internal.approve_staff_package_invoice(uuid) to authenticated;
