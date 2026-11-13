-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_staff_refund_input(p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_ozow_reference is null or btrim(p_ozow_reference) = '' then
    raise exception 'Ozow refund reference required' using errcode='22023', detail='ozow_reference_required';
  end if;
  if p_ozow_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$' then
    raise exception 'Ozow refund reference must be 4 to 100 letters, digits or . _ : / -' using errcode='22023', detail='ozow_reference_invalid';
  end if;
  if p_kind is null or p_kind not in ('refunded', 'chargeback') then
    raise exception 'refund or chargeback required' using errcode='22023';
  end if;
  if p_reason_code is null or p_reason_code not in ('billing_error', 'duplicate', 'our_failure_after_fix_offered',
      's14_cancellation', 'breach_credit') then
    raise exception 'valid refund reason code required' using errcode='22023', detail='refund_reason_code_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
end;
$function$;
alter function internal.assert_staff_refund_input(text,text,text,text) owner to postgres;
revoke all on function internal.assert_staff_refund_input(text,text,text,text) from public;
