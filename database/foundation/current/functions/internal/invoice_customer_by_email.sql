-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invoice_customer_by_email(p_account_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare matches integer; customer uuid;
begin
  if length(btrim(coalesce(p_account_email, ''))) not between 3 and 254 then
    raise exception 'customer email required' using errcode='22023', detail='invoice_payment_invalid';
  end if;
  select count(*), min(u.id::text)::uuid into matches, customer from auth.users u
    where lower(u.email) = lower(btrim(p_account_email)) and u.email_confirmed_at is not null
      and u.is_anonymous is false;
  if matches <> 1 then
    raise exception 'no confirmed account has that email' using errcode='PT404', detail='invoice_account_unavailable';
  end if;
  return customer;
end;
$function$;
alter function internal.invoice_customer_by_email(text) owner to postgres;
revoke all on function internal.invoice_customer_by_email(text) from public;
