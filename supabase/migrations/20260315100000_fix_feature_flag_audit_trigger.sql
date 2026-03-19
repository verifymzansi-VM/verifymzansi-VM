-- Fix feature flag audit trigger:
-- 1. Add 'system' to user_role enum (for automated/trigger audit entries)
-- 2. Fix target_id type mismatch (text key → UUID column)

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'system';
CREATE OR REPLACE FUNCTION log_feature_flag_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (
    actor_id,
    actor_role,
    action,
    target_type,
    target_id,
    metadata,
    created_at
  ) VALUES (
    COALESCE(NEW.updated_by, '00000000-0000-0000-0000-000000000000'::uuid),
    'system',
    'feature_flag_config_changed',
    'feature_flag',
    NEW.id,
    jsonb_build_object(
      'flag_key', NEW.key,
      'old_mode', OLD.mode,
      'new_mode', NEW.mode,
      'old_percent', OLD.rollout_percent,
      'new_percent', NEW.rollout_percent,
      'old_allowlist', OLD.allowlist_roles,
      'new_allowlist', NEW.allowlist_roles,
      'reason', NEW.updated_reason
    ),
    now()
  );
  RETURN NEW;
END;
$$;
