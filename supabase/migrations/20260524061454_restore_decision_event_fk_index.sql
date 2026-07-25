-- Restore the FK-covering index for decision_record_events.decision_id.
-- The Performance Advisor can report FK indexes as unused before traffic
-- exercises them, but removing this index creates an unindexed-FK finding.

CREATE INDEX IF NOT EXISTS idx_decision_events_decision
  ON public.decision_record_events (decision_id);
