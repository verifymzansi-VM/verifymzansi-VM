-- Internal verification columns (posting audit 2026-10-07). Members could
-- read, on their own rows: fraud-scoring signals (risk level/score, automatic
-- decision, override codes), the reviewing staff member's account id, and
-- the encrypted ID number with its IV, tag and lookup HMAC. Scores help a
-- fraudster tune a fake submission; staff ids are staff personal data.
-- The app reads this table only with the service role, so members and the
-- public keep every other column (status, reason, names, location) and lose
-- just these. A column added later is not readable by anon/authenticated
-- until granted.
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'verification_steps'
     AND column_name <> ALL (ARRAY[
       'id_number_encrypted', 'id_number_iv', 'id_number_tag', 'id_number_hmac',
       'risk_level', 'risk_score', 'auto_status', 'override_reason_code',
       'override_decision_id', 'reviewed_by'
     ]);
  EXECUTE 'REVOKE SELECT ON public.verification_steps FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.verification_steps TO authenticated', cols);
END;
$$;
