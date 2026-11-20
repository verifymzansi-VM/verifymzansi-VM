-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.package_invoice_request_dto(r private.package_invoice_requests, p_staff uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('request_id', r.id, 'status', r.status, 'term_days', r.term_days, 'slots', r.slots,
    'unit_price_cents', r.unit_price_cents, 'total_cents', r.total_cents, 'requested_at', r.requested_at,
    'invoice_number', (select i.invoice_number from private.customer_invoices i where i.id = r.invoice_id),
    'closed_at', r.closed_at)
  -- 20261120120000: an added-slots request says so, with the days it was
  -- priced for and its package's current end (a new package's is unchanged).
  || case when r.kind = 'add' then jsonb_build_object('kind', 'add', 'days_left', r.days_left,
    'package_ends_at', (select max(e.ends_at) from private.entitlements e
      where e.package_id = r.package_id and e.status = 'active')) else '{}'::jsonb end
  || case when p_staff is null then '{}'::jsonb else jsonb_build_object('account_id', r.account_id,
    'customer_email', (select u.email from auth.users u where u.id = r.account_id),
    'customer_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = r.account_id)),
    'identity_accepted', internal.current_verified_identity(r.account_id) is not null,
    'package_open', internal.slot_package_open(r.account_id),
    'needs_approval', r.total_cents > internal.package_invoice_approval_above_cents(),
    'due_days', r.due_days, 'staff_reason', r.staff_reason, 'prepared_at', r.prepared_at,
    'prepared_by_me', coalesce(internal.same_identity(r.prepared_by, p_staff), false),
    'prepared_by_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = r.prepared_by)),
    'close_reason', r.close_reason) end;
$function$;
alter function internal.package_invoice_request_dto(private.package_invoice_requests,uuid) owner to postgres;
revoke all on function internal.package_invoice_request_dto(private.package_invoice_requests,uuid) from public;
