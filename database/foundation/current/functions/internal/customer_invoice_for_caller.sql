-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_for_caller(p_invoice_number text, p_link_hash text)
 RETURNS private.customer_invoices
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; inv private.customer_invoices;
begin
  if p_link_hash is null then
    -- The signed-in member's own invoice; anyone else's number is not found.
    actor := internal.price_draft_actor();
    select * into inv from private.customer_invoices i
      where i.invoice_number = internal.customer_invoice_number(p_invoice_number) and i.account_id = actor;
  else
    -- Only the website's server (the service role) acts through a link.
    if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
      raise exception 'payment links are for the website''s server' using errcode='42501';
    end if;
    -- The invoice whose current payment link this is, of an account that can
    -- still use the site, until 30 days after its due date; any other hash,
    -- an erased, closed or blocked account, or an older link, is not found.
    select * into inv from private.customer_invoices i
      where i.pay_link_hash = p_link_hash
        and i.due_on + 30 >= internal.customer_invoice_day(statement_timestamp())
        and exists(select 1 from private.current_account_access a where a.id = i.account_id);
  end if;
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  return inv;
end;
$function$;
alter function internal.customer_invoice_for_caller(text,text) owner to postgres;
revoke all on function internal.customer_invoice_for_caller(text,text) from public;
