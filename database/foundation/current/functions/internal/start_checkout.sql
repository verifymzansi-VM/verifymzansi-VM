-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.start_checkout(p_product_id uuid, p_target_post uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  addon private.addon_versions;
  pay private.payments;
  target private.posts;
  purchase_entitlement uuid;
begin
  if p_product_id is null then raise exception 'product required' using errcode = '22023'; end if;
  perform internal.lock_evidence_subject(actor);
  perform internal.price_draft_actor();
  if exists(select 1 from private.plan_versions v where v.id = p_product_id) then
    raise exception 'slots are bought with the slot checkout' using errcode = '22023';
  end if;
  select * into addon from private.addon_versions v where v.id = p_product_id and v.retired_at is null;
  if not found then raise exception 'product not available' using errcode = '22023'; end if;
  select * into target from private.posts p where p.id=p_target_post and p.owner_id=actor for update;
  if not found or target.status <> 'live' then
    raise exception 'add-ons apply to your own live post' using errcode = '22023';
  end if;
  if addon.kind in ('boost','featured') and target.kind <> 'event' then
    raise exception 'Boost and Featured are offered only for events' using errcode='22023';
  end if;
  if not exists(select 1 from private.public_eligible_posts p where p.id=target.id)
    or target.published_at>clock_timestamp() or target.visible_until<=clock_timestamp()
    or not exists(select 1 from internal.post_funding(target.id) f where f.funded_until>clock_timestamp()) then
    raise exception 'add-on target is no longer publicly eligible' using errcode='PT409';
  end if;
  purchase_entitlement:=internal.addon_purchase_entitlement(actor,target.id,addon.kind);
  if purchase_entitlement is null then
    raise exception 'an eligible paid capability for this area and converted content is required' using errcode='PT403';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  select * into pay from private.payments p
    where p.owner_id = actor and p.status = 'pending'
      and p.addon_version_id = p_product_id
      and p.target_post_id is not distinct from p_target_post;
  if not found then
    insert into private.payments (owner_id, product_kind, addon_version_id, target_post_id,
      amount_cents, currency, snapshot)
    values (actor, 'addon', addon.id, p_target_post, addon.price_cents, addon.currency,
      jsonb_build_object('kind', 'addon', 'addon', addon.kind, 'version', addon.version,
          'days', addon.days, 'price_cents', addon.price_cents, 'target_kind',target.kind,
          'target_area',target.area,'target_owner_id',target.owner_id,
          'purchase_entitlement_id',purchase_entitlement,
          'addon_capabilities',(select to_jsonb(e.addon_capabilities) from private.entitlements e where e.id=purchase_entitlement)))
    returning * into pay;
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'reused', pay.created_at < statement_timestamp());
end;
$function$;
alter function internal.start_checkout(uuid,uuid) owner to postgres;
revoke all on function internal.start_checkout(uuid,uuid) from public;
grant execute on function internal.start_checkout(uuid,uuid) to authenticated;
