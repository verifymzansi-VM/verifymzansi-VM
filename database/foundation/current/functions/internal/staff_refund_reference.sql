-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_refund_reference(p_payment_id uuid, p_reference text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare reference text;
begin
  if exists(select 1 from private.payments p where p.id = p_payment_id and p.provider = 'invoice') then
    reference := regexp_replace(btrim(coalesce(p_reference, '')), '\s+', ' ', 'g');
    if reference = '' then
      raise exception 'bank refund reference required' using errcode='22023', detail='refund_reference_required';
    end if;
    if reference !~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,99}$'
        or length(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g')) < 4 then
      raise exception 'bank refund reference must be 4 to 100 letters, digits, spaces or . _ : / -'
        using errcode='22023', detail='refund_reference_invalid';
    end if;
    return reference;
  end if;
  if p_reference is null or btrim(p_reference) = '' then
    raise exception 'Ozow refund reference required' using errcode='22023', detail='ozow_reference_required';
  end if;
  if p_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$' then
    raise exception 'Ozow refund reference must be 4 to 100 letters, digits or . _ : / -' using errcode='22023', detail='ozow_reference_invalid';
  end if;
  return p_reference;
end;
$function$;
alter function internal.staff_refund_reference(uuid,text) owner to postgres;
revoke all on function internal.staff_refund_reference(uuid,text) from public;
