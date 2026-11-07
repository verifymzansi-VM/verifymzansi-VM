-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_frontend_staff_payment_reversal(p_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid;owner uuid;prior private.frontend_payment_reversals;result jsonb;
begin
  actor:=internal.staff_actor('payments:refund');
  if p_id is null or p_kind is null or p_kind not in('refunded','chargeback')
    or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false)
    then raise exception 'valid reversal and reason required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||p_id::text,0));
  perform internal.staff_actor('payments:refund');
  select * into prior from private.frontend_payment_reversals where payment_id=p_id;
  if found then
    if prior.actor_id=actor and prior.kind=p_kind and prior.reason=p_reason then
      return jsonb_build_object('status',prior.kind,'released_activations',prior.released_activations);
    end if;
    raise exception 'payment already reversed' using errcode='PT409';
  end if;
  select owner_id into owner from private.payments where id=p_id;
  if owner=actor then raise exception 'a different staff member must record this reversal' using errcode='42501';end if;
  result:=internal.reverse_payment(p_id,p_kind,p_reason);
  perform internal.staff_actor('payments:refund');
  insert into private.frontend_payment_reversals(payment_id,actor_id,kind,reason,released_activations)
    values(p_id,actor,p_kind,p_reason,(result->>'released_activations')::integer);
  return result;
end$function$;
alter function internal.record_frontend_staff_payment_reversal(uuid,text,text) owner to postgres;
revoke all on function internal.record_frontend_staff_payment_reversal(uuid,text,text) from public;
grant execute on function internal.record_frontend_staff_payment_reversal(uuid,text,text) to authenticated;
