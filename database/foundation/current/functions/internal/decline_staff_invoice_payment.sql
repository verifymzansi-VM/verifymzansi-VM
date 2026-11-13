-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.decline_staff_invoice_payment(p_transfer_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; t private.invoice_transfers;
begin
  actor := internal.staff_actor('payments:confirm_transfer');
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'decline reason required' using errcode='22023';
  end if;
  t := internal.lock_invoice_transfer_for_review(p_transfer_id, actor);
  if t.status = 'declined' and t.declined_by = actor and t.decline_reason = btrim(p_reason) then
    return internal.invoice_transfer_dto(t, actor) || jsonb_build_object('repeated', true);
  end if;
  if t.status <> 'awaiting_confirmation' then
    raise exception 'this bank transfer was already %; it cannot be declined', t.status
      using errcode='PT409', detail='transfer_not_waiting';
  end if;
  update private.invoice_transfers set status = 'declined', declined_by = actor,
      declined_at = statement_timestamp(), decline_reason = btrim(p_reason)
    where id = t.id returning * into t;
  if internal.staff_actor('payments:confirm_transfer') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return internal.invoice_transfer_dto(t, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.decline_staff_invoice_payment(uuid,text) owner to postgres;
revoke all on function internal.decline_staff_invoice_payment(uuid,text) from public;
grant execute on function internal.decline_staff_invoice_payment(uuid,text) to authenticated;
