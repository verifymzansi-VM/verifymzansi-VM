-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.resolve_expired_invoice_transfer(p_transfer_id uuid, p_resolution text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; t private.invoice_transfers;
begin
  actor := internal.staff_actor('payments:confirm_transfer');
  if p_resolution is null or p_resolution not in ('returned', 'never_arrived') then
    raise exception 'resolution must be returned or never_arrived' using errcode='22023';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'resolution reason required' using errcode='22023';
  end if;
  t := internal.lock_invoice_transfer_for_review(p_transfer_id, actor);
  if t.resolved_at is not null then
    if t.resolved_by = actor and t.resolution = p_resolution and t.resolution_reason = btrim(p_reason) then
      return internal.invoice_transfer_dto(t, actor) || jsonb_build_object('status', 'expired',
        'resolution', t.resolution, 'repeated', true);
    end if;
    raise exception 'this expired bank transfer was already resolved' using errcode='PT409', detail='transfer_resolved';
  end if;
  if not internal.invoice_transfer_expired(t) then
    raise exception 'only an expired bank transfer is resolved; confirm or decline a waiting one'
      using errcode='PT409', detail='transfer_not_expired';
  end if;
  if t.status = 'awaiting_confirmation' then
    perform internal.expire_invoice_transfer(t.id);
  end if;
  update private.invoice_transfers set resolution = p_resolution, resolution_reason = btrim(p_reason),
      resolved_by = actor, resolved_at = statement_timestamp()
    where id = t.id returning * into t;
  if internal.staff_actor('payments:confirm_transfer') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return internal.invoice_transfer_dto(t, actor) || jsonb_build_object('status', 'expired',
    'resolution', t.resolution, 'repeated', false);
end;
$function$;
alter function internal.resolve_expired_invoice_transfer(uuid,text,text) owner to postgres;
revoke all on function internal.resolve_expired_invoice_transfer(uuid,text,text) from public;
grant execute on function internal.resolve_expired_invoice_transfer(uuid,text,text) to authenticated;
