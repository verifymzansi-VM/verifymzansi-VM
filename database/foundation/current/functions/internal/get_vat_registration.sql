-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_vat_registration()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  -- The VAT setting the invoices check; the number only when registered.
  select jsonb_build_object('status', coalesce(c.registration_status, 'undecided'),
    'vat_number', case when c.registration_status = 'registered' then btrim(c.vat_number) end)
  from (select true as singleton) s
    left join private.invoice_merchant_config c on c.singleton = s.singleton;
$function$;
alter function internal.get_vat_registration() owner to postgres;
revoke all on function internal.get_vat_registration() from public;
grant execute on function internal.get_vat_registration() to anon;
grant execute on function internal.get_vat_registration() to authenticated;
