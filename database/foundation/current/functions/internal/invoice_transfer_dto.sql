-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invoice_transfer_dto(t private.invoice_transfers, p_actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('transfer_id', t.id, 'status', t.status, 'account_id', t.account_id,
    'customer_email', (select u.email from auth.users u where u.id = t.account_id),
    'similar_records', (select count(*) from private.invoice_transfers x where x.id <> t.id
      and x.status <> 'declined' and x.amount_received_cents = t.amount_received_cents
      and (upper(regexp_replace(x.bank_reference, '[^A-Za-z0-9]', '', 'g'))
          = upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g'))
        or (x.account_id = t.account_id and x.cleared_on = t.cleared_on))),
    'customer_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = t.account_id)),
    'term_days', (select v.duration_days from private.plan_versions v where v.id = t.plan_version_id),
    'slots', t.slots, 'amount_received_cents', t.amount_received_cents, 'bank_reference', t.bank_reference,
    'cleared_on', to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'), 'reason', t.reason,
    'recorded_at', t.recorded_at, 'recorded_by_me', internal.same_identity(t.recorded_by, p_actor),
    'recorded_by_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = t.recorded_by)),
    'payment_id', t.payment_id);
$function$;
alter function internal.invoice_transfer_dto(private.invoice_transfers,uuid) owner to postgres;
revoke all on function internal.invoice_transfer_dto(private.invoice_transfers,uuid) from public;
