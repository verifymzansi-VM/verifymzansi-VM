-- ══════════════════════════════════════════════════════════════
-- Feature Flags — Staged Canary Rollout Support
-- Adds mode, rollout %, allowlist, audit trail columns
-- ══════════════════════════════════════════════════════════════

-- Add canary columns
ALTER TABLE public.feature_flags
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'off'
    CHECK (mode IN ('off', 'on', 'percent', 'allowlist')),
  ADD COLUMN IF NOT EXISTS rollout_percent INTEGER NOT NULL DEFAULT 0
    CHECK (rollout_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS allowlist_roles TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_reason TEXT;

-- Backfill mode from existing enabled boolean
UPDATE public.feature_flags
SET mode = CASE WHEN enabled THEN 'on' ELSE 'off' END
WHERE mode = 'off' AND enabled = true;

-- ── Audit trigger for flag config changes ───────────────────
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
    NEW.key,
    jsonb_build_object(
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

CREATE TRIGGER trg_feature_flag_audit
  AFTER UPDATE ON public.feature_flags
  FOR EACH ROW
  WHEN (OLD.mode IS DISTINCT FROM NEW.mode
     OR OLD.rollout_percent IS DISTINCT FROM NEW.rollout_percent
     OR OLD.allowlist_roles IS DISTINCT FROM NEW.allowlist_roles
     OR OLD.enabled IS DISTINCT FROM NEW.enabled)
  EXECUTE FUNCTION log_feature_flag_change();
