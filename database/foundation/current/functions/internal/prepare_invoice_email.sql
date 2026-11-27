-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.prepare_invoice_email(p_invoice_id uuid, p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices;
begin
  if p_invoice_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invoice and payment link hash required' using errcode='22023';
  end if;
  -- Each sending gets a new link: its hash replaces the earlier one, while the
  -- invoice is unpaid.
  update private.customer_invoices set pay_link_hash = p_token_hash
    where id = p_invoice_id and status = 'issued' and account_id is not null;
  select * into inv from private.customer_invoices i where i.id = p_invoice_id and i.account_id is not null;
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  return jsonb_build_object('invoice_number', inv.invoice_number, 'status', inv.status, 'owner_id', inv.account_id,
    'description', inv.description, 'total_cents', inv.total_cents,
    'due_on', to_char(inv.due_on::timestamp, 'YYYY-MM-DD'));
end;
$function$;
alter function internal.prepare_invoice_email(uuid,text) owner to postgres;
revoke all on function internal.prepare_invoice_email(uuid,text) from public;
grant execute on function internal.prepare_invoice_email(uuid,text) to service_role;
