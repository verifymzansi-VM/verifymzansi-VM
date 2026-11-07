-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reverse_payment(p_payment_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; released integer := 0; v_post_ids uuid[]; payment_owner uuid;
begin
  if p_kind not in ('refunded', 'chargeback') or length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'reversal kind and audit reason required' using errcode = '22023';
  end if;
  select p.owner_id into payment_owner from private.payments p where p.id=p_payment_id;
  if payment_owner is not null then perform internal.lock_evidence_subject(payment_owner); end if;
  select * into pay from private.payments p where p.id = p_payment_id for update;
  if not found or pay.status <> 'complete' then
    raise exception 'only completed payments can be reversed' using errcode = '22023';
  end if;
  begin
    perform e.id from private.entitlements e where e.payment_id=pay.id order by e.id for update nowait;
    perform p.id from private.posts p where p.id=pay.target_post_id or p.id in
      (select a.post_id from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
        where e.payment_id=pay.id and a.released_at is null)
      order by p.id for update of p nowait;
  exception when lock_not_available then
    raise exception 'funded posts are busy; retry reversal' using errcode='PT409';
  end;
  update private.payments set status = p_kind, fulfillment_status='reversed', status_changed_at = statement_timestamp() where id = pay.id;
  update private.entitlements set status = 'revoked', revoked_reason = 'payment_' || p_kind where payment_id = pay.id;
  with released_rows as (
    update private.post_activations a set released_at = statement_timestamp(), release_reason = 'payment_reversed'
    from private.entitlements e where e.id = a.entitlement_id and e.payment_id = pay.id and a.released_at is null
    returning a.post_id
  )
  select coalesce(array_agg(post_id), '{}') into v_post_ids from released_rows;
  released := cardinality(v_post_ids);
  update private.posts set status = 'expired', status_reason = 'Payment ' || p_kind, revision = revision + 1
    where id = any (v_post_ids) and status in ('live', 'pending_moderation');
  update private.post_search_documents set is_visible = false where post_id = any (v_post_ids);
  update private.post_addon_windows set revoked_at = statement_timestamp() where payment_id = pay.id and revoked_at is null;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_reversed:' || pay.id);
  return jsonb_build_object('status', p_kind, 'released_activations', released);
end;
$function$;
alter function internal.reverse_payment(uuid,text,text) owner to postgres;
revoke all on function internal.reverse_payment(uuid,text,text) from public;
grant execute on function internal.reverse_payment(uuid,text,text) to service_role;
