-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.activate_staff_paid_payment(p_payment_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; pay private.payments; snap jsonb; prior private.payment_activations;
  target private.posts; line_count integer := 0; made integer := 0; window_start timestamptz;
  fingerprint text; commissions integer := 0; has_lines boolean;
begin
  actor := internal.staff_actor('payments:refund');
  if p_payment_id is null or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false) then
    raise exception 'payment and audit reason required' using errcode='22023';
  end if;
  select p.owner_id into buyer from private.payments p where p.id = p_payment_id;
  if buyer is null then raise exception 'payment not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.lock_evidence_subject(buyer);
  select * into pay from private.payments p where p.id = p_payment_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  select * into prior from private.payment_activations a where a.payment_id = pay.id;
  if found then
    if prior.actor_id = actor and prior.reason = btrim(p_reason) then
      return jsonb_build_object('payment_id', pay.id, 'fulfillment_status', pay.fulfillment_status,
        'entitlements', prior.entitlements, 'addon_window', prior.addon_window, 'commissions', prior.commissions,
        'repeated', true);
    end if;
    raise exception 'this payment was already activated' using errcode='PT409', detail='payment_already_activated';
  end if;
  if pay.status <> 'complete' or pay.fulfillment_status <> 'needs_reconciliation' then
    raise exception 'only a paid payment that was not delivered can be activated' using errcode='PT409', detail='payment_not_awaiting_activation';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  if not exists(select 1 from private.current_account_access u where u.id = pay.owner_id) then
    raise exception 'the account that paid cannot use it now; refund instead' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  snap := pay.snapshot;
  if pay.product_kind = 'addon' then
    select * into target from private.posts p where p.id = pay.target_post_id for update;
    if not (found and target.owner_id = pay.owner_id
        and target.owner_id::text = snap->>'target_owner_id'
        and target.kind = snap->>'target_kind' and target.area = snap->>'target_area'
        and (snap->>'addon' = 'urgent' or target.kind = 'event')
        and target.published_at <= clock_timestamp() and target.visible_until > clock_timestamp()
        and exists(select 1 from private.public_eligible_posts p where p.id = target.id)
        and exists(select 1 from internal.post_funding(target.id) f where f.funded_until > clock_timestamp())
        and coalesce((snap->'addon_capabilities') ? (snap->>'addon'), false)
        and internal.addon_purchase_entitlement(pay.owner_id, target.id, snap->>'addon') is not null) then
      raise exception 'the post can no longer carry this add-on; refund instead' using errcode='PT409', detail='addon_target_ineligible';
    end if;
    select greatest(statement_timestamp(), coalesce(max(w.ends_at), statement_timestamp())) into window_start
    from private.post_addon_windows w
    where w.post_id = pay.target_post_id and w.kind = snap->>'addon' and w.revoked_at is null;
    insert into private.post_addon_windows (post_id, kind, payment_id, starts_at, ends_at)
    values (pay.target_post_id, snap->>'addon', pay.id, window_start,
      window_start + make_interval(days => (snap->>'days')::integer));
  else
    has_lines := exists(select 1 from private.payment_lines l where l.payment_id = pay.id);
    if exists(select 1 from private.entitlements e where e.payment_id = pay.id) then
      raise exception 'this payment already has a slot; check it before activating' using errcode='PT409', detail='payment_slot_exists';
    end if;
    if has_lines then
      select count(*) into line_count from private.payment_lines l where l.payment_id = pay.id and l.status = 'open';
      if line_count = 0 then
        raise exception 'every slot of this payment was refunded' using errcode='PT409', detail='payment_slots_refunded';
      end if;
      -- Within the person's Individual slot limit (every account of the identity).
      fingerprint := internal.individual_slot_identity(pay.owner_id);
      if fingerprint is not null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
      end if;
      if (internal.individual_slots_counted(fingerprint, pay.owner_id, pay.id)->>'held')::integer + line_count
          > internal.individual_slot_limit(fingerprint) then
        raise exception 'more slots than the person''s limit; raise the limit or refund' using errcode='PT429', detail='slot_limit_reached';
      end if;
      insert into private.entitlements (owner_id, source, area, payment_id, payment_line_id, slot_capacity,
        activations_per_period, activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      select pay.owner_id, 'retail_paid', snap->>'area', pay.id, l.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb)))
      from private.payment_lines l where l.payment_id = pay.id and l.status = 'open' order by l.line_number;
    else
      insert into private.entitlements (owner_id, source, area, payment_id, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))));
    end if;
    get diagnostics made = row_count;
  end if;
  -- The status stays complete, so the commission trigger does not fire: the
  -- delivered purchase earns its commission here.
  update private.payments set fulfillment_status = 'fulfilled' where id = pay.id;
  commissions := internal.payment_delivery_commission(pay.id);
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_activations (payment_id, actor_id, reason, entitlements, addon_window, commissions)
    values (pay.id, actor, btrim(p_reason), made, pay.product_kind = 'addon', commissions);
  return jsonb_build_object('payment_id', pay.id, 'fulfillment_status', 'fulfilled', 'entitlements', made,
    'addon_window', pay.product_kind = 'addon', 'commissions', commissions, 'repeated', false);
end;
$function$;
alter function internal.activate_staff_paid_payment(uuid,text) owner to postgres;
revoke all on function internal.activate_staff_paid_payment(uuid,text) from public;
grant execute on function internal.activate_staff_paid_payment(uuid,text) to authenticated;
