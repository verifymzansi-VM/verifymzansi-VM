-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_invoice_customer(p_account_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; matches integer; fingerprint text; result jsonb;
begin
  actor := internal.staff_actor('payments:refund');
  if length(btrim(coalesce(p_account_email, ''))) not between 3 and 254 then
    raise exception 'customer email required' using errcode='22023', detail='invoice_payment_invalid';
  end if;
  select count(*), min(u.id::text)::uuid into matches, buyer from auth.users u
    where lower(u.email) = lower(btrim(p_account_email)) and u.email_confirmed_at is not null
      and u.is_anonymous is false;
  if matches <> 1 then
    raise exception 'no confirmed account has that email' using errcode='PT404', detail='invoice_account_unavailable';
  end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.assert_staff_not_referrer(actor, buyer);
  fingerprint := internal.current_verified_identity(buyer);
  result := jsonb_build_object('customer_name', internal.profile_public_name(
      (select f.display_name from private.profiles f where f.account_id = buyer)),
    'id_reviewed', fingerprint is not null,
    'can_use_slots', exists(select 1 from private.current_account_access a where a.id = buyer),
    'slots_held', case when fingerprint is null then null
      else (internal.individual_slots_counted(fingerprint, buyer, null)->>'held')::integer end,
    'slot_limit', case when fingerprint is null then null else internal.individual_slot_limit(fingerprint) end);
  if internal.staff_actor('payments:refund') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_invoice_customer(text) owner to postgres;
revoke all on function internal.get_staff_invoice_customer(text) from public;
grant execute on function internal.get_staff_invoice_customer(text) to authenticated;
