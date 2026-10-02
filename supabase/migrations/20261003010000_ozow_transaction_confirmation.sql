-- Keep provider_payment_id as the One API payment-request ID. The transaction
-- ID is recorded separately, under the same lock/transaction as fulfillment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_ozow_transaction_id_unique
  ON public.payments ((provider_data->>'transaction_id'))
  WHERE provider = 'ozow' AND nullif(provider_data->>'transaction_id', '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.confirm_ozow_payment(
  p_payment_id uuid, p_provider_payment_id text, p_expected_amount integer, p_expected_metadata jsonb,
  p_plan_id uuid, p_addon_days numeric, p_webhook jsonb,
  p_provider_transaction_id text, p_merchant_reference text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.provider <> 'ozow' OR v_payment.provider_payment_id IS DISTINCT FROM p_provider_payment_id
     OR nullif(p_provider_payment_id, '') IS NULL THEN
    RAISE EXCEPTION 'Payment request ID mismatch';
  END IF;
  IF nullif(p_merchant_reference, '') IS NULL OR
     coalesce(v_payment.provider_reference, replace(v_payment.id::text, '-', '')) <> p_merchant_reference THEN
    RAISE EXCEPTION 'Merchant reference mismatch';
  END IF;
  IF nullif(p_provider_transaction_id, '') IS NULL THEN RAISE EXCEPTION 'Missing transaction ID'; END IF;
  IF nullif(v_payment.provider_data->>'transaction_id', '') IS NOT NULL AND
     v_payment.provider_data->>'transaction_id' <> p_provider_transaction_id THEN
    RAISE EXCEPTION 'Transaction ID mismatch';
  END IF;
  -- Never record a new confirmation for a reversed or explicitly cancelled row.
  IF v_payment.status NOT IN ('pending', 'failed', 'expired', 'processing', 'complete') THEN
    RETURN jsonb_build_object('outcome', 'ignored');
  END IF;
  -- Older checkouts store business metadata at the top level. The claim RPC
  -- can change only this operational timestamp between read and confirmation.
  IF v_payment.status IN ('pending', 'failed', 'expired')
     AND nullif(v_payment.provider_data->>'type', '') IS NOT NULL
     AND nullif(v_payment.provider_data->'metadata'->>'type', '') IS NULL THEN
    IF (v_payment.provider_data - 'reconciliation_checked_at') IS DISTINCT FROM
       (p_expected_metadata - 'reconciliation_checked_at') THEN
      RAISE EXCEPTION 'Payment metadata changed or missing';
    END IF;
    p_expected_metadata := v_payment.provider_data;
  END IF;
  -- Re-entrant row lock: every effect, invoice and identifier is one commit.
  v_result := public.fulfill_ozow_payment(p_payment_id, p_provider_payment_id, p_expected_amount,
    p_expected_metadata, p_plan_id, p_addon_days, p_webhook);
  IF v_result->>'outcome' <> 'ignored' THEN
    UPDATE public.payments SET provider_data = coalesce(provider_data, '{}'::jsonb)
      || jsonb_build_object('transaction_id', p_provider_transaction_id)
      WHERE id = p_payment_id;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_ozow_payment(uuid, text, integer, jsonb, uuid, numeric, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_ozow_payment(uuid, text, integer, jsonb, uuid, numeric, jsonb, text, text) TO service_role;

-- Persistent throttling across app isolates and scheduled jobs. Never replace
-- provider_data from a stale application snapshot or modify confirmed rows.
CREATE OR REPLACE FUNCTION public.claim_ozow_reconciliation(p_payment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.payments SET provider_data = coalesce(provider_data, '{}'::jsonb)
    || jsonb_build_object('reconciliation_checked_at', now())
  WHERE id = p_payment_id AND provider = 'ozow' AND status IN ('pending', 'failed', 'expired')
    AND provider_payment_id IS NOT NULL
    AND (provider_data->>'reconciliation_checked_at' IS NULL
      OR (provider_data->>'reconciliation_checked_at')::timestamptz < now() - interval '60 seconds');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_ozow_reconciliation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ozow_reconciliation(uuid) TO service_role;
