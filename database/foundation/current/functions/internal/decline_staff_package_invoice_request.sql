-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.decline_staff_package_invoice_request(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; r private.package_invoice_requests;
begin
  actor := internal.staff_actor('payments:refund');
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  r := internal.lock_package_invoice_request(p_request_id, actor, 'payments:refund');
  if r.status = 'declined' and r.closed_by = actor and r.close_reason = btrim(p_reason) then
    return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('repeated', true);
  end if;
  if r.status not in ('requested', 'awaiting_approval') then
    raise exception 'this invoice request is already %', replace(r.status, '_', ' ')
      using errcode='PT409', detail='package_invoice_request_closed';
  end if;
  update private.package_invoice_requests set status = 'declined', closed_by = actor, closed_at = statement_timestamp(),
      close_reason = btrim(p_reason)
    where id = r.id returning * into r;
  if internal.staff_actor('payments:refund') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.decline_staff_package_invoice_request(uuid,text) owner to postgres;
revoke all on function internal.decline_staff_package_invoice_request(uuid,text) from public;
grant execute on function internal.decline_staff_package_invoice_request(uuid,text) to authenticated;
