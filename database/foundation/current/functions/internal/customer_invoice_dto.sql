-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_dto(i private.customer_invoices, p_staff uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'status', i.status,
    'issued_at', i.issued_at, 'due_on', to_char(i.due_on::timestamp, 'YYYY-MM-DD'),
    'seller', i.seller,
    'buyer', case when i.buyer_name is null then null else jsonb_build_object('name', i.buyer_name,
      'address', i.buyer_address, 'registration_number', i.buyer_registration_number) end,
    'revision', i.revision, 'term_days', (select v.duration_days from private.plan_versions v where v.id = i.plan_version_id),
    'slots', i.slots, 'unit_price_cents', i.unit_price_cents, 'total_cents', i.total_cents,
    'description', i.description, 'currency', 'ZAR', 'payment_reference', i.invoice_number,
    'cooling_off_consent_at', i.cooling_off_consent_at, 'cooling_off_consent_version', i.cooling_off_consent_version,
    'consent', internal.customer_invoice_consent(),
    'paid_at', i.paid_at, 'payment_id', i.payment_id,
    'payment_status', (select p.status from private.payments p where p.id = i.payment_id),
    'voided_at', i.voided_at,
    'transfer_waiting', exists(select 1 from private.invoice_transfers t
      where t.customer_invoice_id = i.id and t.status = 'awaiting_confirmation'),
    'latest_attempt', (select jsonb_build_object('payment_id', p.id, 'attempt', l.attempt, 'status', p.status,
        'checkout_open', p.status = 'pending' and p.checkout_url is not null
          and p.checkout_expires_at > pg_catalog.clock_timestamp())
      from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
      where l.invoice_id = i.id order by l.attempt desc limit 1))
  || case when p_staff is null then '{}'::jsonb else jsonb_build_object('account_id', i.account_id,
    'customer_email', (select u.email from auth.users u where u.id = i.account_id),
    'customer_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = i.account_id)),
    'issued_by_me', internal.same_identity(i.issued_by, p_staff),
    'issued_by_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = i.issued_by)),
    'issue_reason', i.issue_reason, 'void_reason', i.void_reason,
    'attempts', (select count(*) from private.customer_invoice_payments l where l.invoice_id = i.id),
    'extra_payments', coalesce((select jsonb_agg(p.id order by p.completed_at, p.id)
      from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
      where l.invoice_id = i.id and p.completed_at is not null and p.id is distinct from i.payment_id), '[]'::jsonb)) end;
$function$;
alter function internal.customer_invoice_dto(private.customer_invoices,uuid) owner to postgres;
revoke all on function internal.customer_invoice_dto(private.customer_invoices,uuid) from public;
