-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.billing_payment_dto(p private.payments)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('id',p.id,'owner_id',p.owner_id,'product_kind',p.product_kind,
    'product_id',coalesce(p.plan_version_id,p.addon_version_id),'target_post_id',p.target_post_id,
    'amount_cents',p.amount_cents::text,'currency',p.currency,'status',p.status,
    'fulfillment_status',p.fulfillment_status,'merchant_reference',p.merchant_reference,
    'provider_request_id',p.provider_request_id,'provider_transaction_id',p.provider_transaction_id,
    'checkout_url',p.checkout_url,'checkout_expires_at',p.checkout_expires_at,
    'created_at',p.created_at,'label',coalesce(p.snapshot->>'label',initcap(p.snapshot->>'addon')||' add-on'));
$function$;
alter function internal.billing_payment_dto(private.payments) owner to postgres;
revoke all on function internal.billing_payment_dto(private.payments) from public;
