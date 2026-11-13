-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_invoice_customer(p_account_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; fingerprint text; result jsonb;
begin
  actor := internal.staff_actor('payments:refund');
  buyer := internal.invoice_customer_by_email(p_account_email);
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
