-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_refund_repeat(p_actor uuid, p_payment_id uuid, p_line_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare prior private.payment_refund_requests;
begin
  select * into prior from private.payment_refund_requests r where lower(r.ozow_reference) = lower(btrim(p_ozow_reference));
  if not found then return null; end if;
  if prior.payment_id = p_payment_id and prior.payment_line_id is not distinct from p_line_id and prior.kind = p_kind
      and prior.reason_code = p_reason_code and prior.reason = btrim(p_reason) and prior.requested_by = p_actor then
    return jsonb_build_object('request_id', prior.id, 'status', prior.status, 'kind', prior.kind,
      'released_activations', prior.released_activations,
      'payment_status', (select p.status from private.payments p where p.id = prior.payment_id), 'repeated', true);
  end if;
  raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
end;
$function$;
alter function internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) owner to postgres;
revoke all on function internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) from public;
