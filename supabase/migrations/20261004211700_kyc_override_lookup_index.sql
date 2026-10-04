-- Keep decision-record foreign-key checks bounded without indexing ordinary
-- verification submissions, whose override_decision_id remains null.
CREATE INDEX verification_steps_override_decision_idx
  ON public.verification_steps (override_decision_id)
  WHERE override_decision_id IS NOT NULL;
