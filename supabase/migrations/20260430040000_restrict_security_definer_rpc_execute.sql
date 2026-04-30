-- Restrict SECURITY DEFINER helpers from being directly executable via public RPC roles.
--
-- Supabase grants EXECUTE on functions to PUBLIC by default unless revoked. These
-- helpers are intended for triggers, RLS checks, or server-side service-role flows,
-- not direct anon/authenticated RPC access.

BEGIN;

DO $$
DECLARE
  target_function TEXT;
  function_identity TEXT;
BEGIN
  FOREACH target_function IN ARRAY ARRAY[
    'check_business_limit',
    'check_kyc_velocity',
    'check_listing_limit',
    'claim_free_post_slot',
    'enforce_identity_locks',
    'get_content_like_summary',
    'get_content_view_counts',
    'handle_new_user',
    'has_any_role',
    'has_role',
    'increment_otp_attempt',
    'increment_promotion_view_count',
    'log_feature_flag_change',
    'lookup_buyer_verification',
    'record_content_view',
    'rls_auto_enable',
    'set_updated_at',
    'sync_listing_addon_flags',
    'toggle_content_like',
    'update_feature_flag_timestamp'
  ]
  LOOP
    FOR function_identity IN
      SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = target_function
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', function_identity);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', function_identity);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', function_identity);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', function_identity);
    END LOOP;
  END LOOP;
END $$;

COMMIT;
