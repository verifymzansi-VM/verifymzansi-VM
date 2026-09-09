-- Apply before the atomic webhook handler, with webhook delivery and cleanup paused
-- and old handlers drained. See docs/payment-fulfillment-rollout.md. No data backfill.
-- One PostgREST RPC is one transaction: the payment row lock covers every benefit
-- write and completion. Errors roll everything back; retries cannot repeat commits.
CREATE OR REPLACE FUNCTION public.fulfill_ozow_payment(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_expected_amount integer,
  p_expected_metadata jsonb,
  p_plan_id uuid,
  p_addon_days numeric,
  p_webhook jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_meta jsonb;
  v_data jsonb;
  v_account_status text;
  v_outcome text := 'completed';
  v_expires_at timestamptz;
  v_vat integer;
  v_table text;
  v_column text;
  v_owner text;
  v_target uuid;
  v_target_type text;
  v_action text;
  v_rows integer;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.provider <> 'ozow' OR v_payment.amount_cents IS DISTINCT FROM p_expected_amount THEN
    RAISE EXCEPTION 'Payment provider or amount mismatch';
  END IF;
  IF nullif(p_provider_payment_id, '') IS NULL THEN
    RAISE EXCEPTION 'Missing provider payment ID';
  END IF;
  IF v_payment.provider_payment_id IS NOT NULL
     AND v_payment.provider_payment_id <> p_provider_payment_id THEN
    RAISE EXCEPTION 'Payment ID mismatch';
  END IF;
  IF v_payment.status = 'complete' THEN RETURN jsonb_build_object('outcome', 'duplicate'); END IF;
  IF v_payment.status NOT IN ('pending', 'failed', 'expired', 'processing') THEN
    RETURN jsonb_build_object('outcome', 'ignored');
  END IF;

  v_data := coalesce(v_payment.provider_data, '{}'::jsonb);
  v_meta := CASE WHEN jsonb_typeof(v_data->'metadata') = 'object'
                       AND nullif(v_data->'metadata'->>'type', '') IS NOT NULL
                 THEN v_data->'metadata' ELSE v_data END;
  IF v_payment.status = 'processing' THEN
    -- Only the old handler persists processing outside a transaction. Without a
    -- marker it may have committed some effects: time elapsed is not evidence.
    IF jsonb_typeof(v_data->'fulfillment_completed_at') IS DISTINCT FROM 'string'
       OR nullif(v_data->>'fulfillment_completed_at', '') IS NULL THEN
      RAISE EXCEPTION 'Legacy payment requires reconciliation' USING ERRCODE = 'P0001';
    END IF;
    v_outcome := 'recovered';
  ELSE
    IF v_meta IS DISTINCT FROM p_expected_metadata OR nullif(v_meta->>'type', '') IS NULL THEN
      RAISE EXCEPTION 'Payment metadata changed or missing';
    END IF;

    IF v_meta->>'type' = 'subscription' THEN
      SELECT * INTO v_plan FROM public.plans WHERE id = p_plan_id FOR SHARE;
      IF NOT FOUND OR NOT v_plan.active
         OR v_plan.price_cents IS DISTINCT FROM v_payment.amount_cents
         OR v_plan.area IS DISTINCT FROM v_payment.area
         OR v_meta->>'area' IS DISTINCT FROM v_plan.area::text
         OR v_meta->>'plan_tier' IS DISTINCT FROM v_plan.tier::text THEN
        RAISE EXCEPTION 'Paid plan validation failed';
      END IF;
      SELECT account_status::text INTO v_account_status FROM public.account_profiles
        WHERE user_id = v_payment.user_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Account profile not found'; END IF;
      v_expires_at := v_payment.created_at + interval '720 hours';
      INSERT INTO public.entitlements AS existing
        (user_id, area, tier, type, status, cancelled_at, started_at, expires_at)
      VALUES (v_payment.user_id, v_plan.area, v_plan.tier, 'subscription',
        CASE WHEN v_account_status = 'restricted' THEN 'pending_verification'::public.entitlement_status
             ELSE 'active'::public.entitlement_status END,
        NULL, v_payment.created_at, v_expires_at)
      ON CONFLICT (user_id, area, type) DO UPDATE SET
        tier = EXCLUDED.tier, status = EXCLUDED.status, cancelled_at = NULL,
        started_at = EXCLUDED.started_at, expires_at = EXCLUDED.expires_at
      -- A delayed older payment must not overwrite a later purchased plan.
      WHERE existing.started_at <= EXCLUDED.started_at;

      v_vat := round(v_payment.amount_cents::numeric * 1500 / 11500)::integer;
      INSERT INTO public.invoices
        (invoice_number, user_id, payment_id, amount_cents, vat_cents, total_cents, description)
      VALUES (
        'INV-' || to_char(v_payment.created_at AT TIME ZONE 'Africa/Johannesburg', 'YYYYMMDD')
          || '-' || upper(left(v_payment.id::text, 8)),
        v_payment.user_id, v_payment.id, v_payment.amount_cents - v_vat,
        v_vat, v_payment.amount_cents, v_plan.tier::text || ' subscription (' || v_plan.area::text || ')')
      ON CONFLICT (payment_id) DO NOTHING;
      -- An invoice-number collision with a DIFFERENT payment must abort, not be
      -- mistaken for idempotency. Only payment_id is the conflict target above.
    ELSE
      CASE v_meta->>'type'
        WHEN 'boost' THEN v_table := 'listings'; v_column := 'boost_until'; v_target := (v_meta->>'listing_id')::uuid;
        WHEN 'featured' THEN v_table := 'listings'; v_column := 'featured_until'; v_target := (v_meta->>'listing_id')::uuid;
        WHEN 'urgent' THEN v_table := 'listings'; v_column := 'urgent_until'; v_target := (v_meta->>'listing_id')::uuid;
        WHEN 'boost_business' THEN v_table := 'businesses'; v_column := 'boost_until'; v_target := coalesce(v_meta->>'business_id', v_meta->>'business_profile_id')::uuid;
        WHEN 'featured_business' THEN v_table := 'businesses'; v_column := 'featured_until'; v_target := (v_meta->>'business_id')::uuid;
        WHEN 'urgent_business' THEN v_table := 'businesses'; v_column := 'urgent_until'; v_target := (v_meta->>'business_id')::uuid;
        WHEN 'boost_promotion' THEN v_table := 'promotions'; v_column := 'boost_until'; v_target := (v_meta->>'promotion_id')::uuid;
        WHEN 'featured_promotion' THEN v_table := 'promotions'; v_column := 'featured_until'; v_target := (v_meta->>'promotion_id')::uuid;
        WHEN 'urgent_promotion' THEN v_table := 'promotions'; v_column := 'urgent_until'; v_target := (v_meta->>'promotion_id')::uuid;
        WHEN 'boost_storefront' THEN v_table := 'storefronts'; v_column := 'boost_until'; v_target := (v_meta->>'storefront_id')::uuid;
        ELSE RAISE EXCEPTION 'Unsupported payment type';
      END CASE;
      IF v_target IS NULL OR p_addon_days IS NULL OR p_addon_days <= 0
         OR p_addon_days::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Missing target or invalid addon duration';
      END IF;
      -- Preserve compatibility with owner_id and older seller_id schemas. Both
      -- the table and effect column are chosen exclusively from the list above.
      SELECT column_name INTO v_owner FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = v_table
          AND column_name IN ('owner_id', 'seller_id')
        ORDER BY CASE column_name WHEN 'owner_id' THEN 0 ELSE 1 END LIMIT 1;
      IF v_owner IS NULL THEN RAISE EXCEPTION 'Owner column not found'; END IF;
      v_expires_at := v_payment.created_at + p_addon_days * interval '24 hours';
      EXECUTE format('UPDATE public.%I SET %I = greatest(%I, $1) WHERE id = $2 AND %I = $3',
        v_table, v_column, v_column, v_owner) USING v_expires_at, v_target, v_payment.user_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN RAISE EXCEPTION 'Addon target not found or not owned'; END IF;
      v_target_type := CASE v_table WHEN 'businesses' THEN 'business'
        WHEN 'listings' THEN 'listing' WHEN 'promotions' THEN 'promotion' ELSE 'storefront' END;
      v_action := v_target_type || CASE v_column WHEN 'boost_until' THEN '_boosted'
        WHEN 'featured_until' THEN '_featured' ELSE '_urgent' END;
      INSERT INTO public.audit_logs(actor_id, actor_role, action, target_type, target_id, metadata)
      VALUES (v_payment.user_id, 'member', v_action, v_target_type, v_target,
        jsonb_build_object('paymentId', v_payment.id,
          CASE v_column WHEN 'boost_until' THEN 'boostDays' WHEN 'featured_until' THEN 'featureDays' ELSE 'urgentDays' END, p_addon_days,
          CASE v_column WHEN 'boost_until' THEN 'boostUntil' WHEN 'featured_until' THEN 'featuredUntil' ELSE 'urgentUntil' END, v_expires_at));
    END IF;
  END IF;

  UPDATE public.payments SET status = 'complete', provider_payment_id = p_provider_payment_id,
    provider_reference = coalesce(provider_reference, id::text),
    provider_data = v_data || jsonb_build_object(
      'fulfillment_completed_at', coalesce(v_data->>'fulfillment_completed_at', now()::text),
      'fulfillment_state', 'completed', 'completed_at', now(),
      'fulfillment_protocol', 'atomic_v1', 'last_webhook_at', now(),
      'webhooks', CASE WHEN jsonb_typeof(v_data->'webhooks') = 'array' THEN v_data->'webhooks'
                       ELSE '[]'::jsonb END || jsonb_build_array(coalesce(p_webhook, '{}'::jsonb)))
    WHERE id = v_payment.id;
  RETURN jsonb_build_object('outcome', v_outcome, 'expires_at', v_expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_ozow_payment(uuid, text, integer, jsonb, uuid, numeric, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_ozow_payment(uuid, text, integer, jsonb, uuid, numeric, jsonb)
  TO service_role;
NOTIFY pgrst, 'reload schema';
