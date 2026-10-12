-- Disposable local PostgreSQL only. The complete fixture is rolled back.
BEGIN;
CREATE FUNCTION public.audit_test_fail_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.r2_key LIKE 'synthetic-fault/%' THEN RAISE EXCEPTION 'synthetic schedule failure'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER audit_test_fail_retention BEFORE UPDATE OF purge_after ON public.kyc_artifacts
FOR EACH ROW EXECUTE FUNCTION public.audit_test_fail_retention();
DO $$
DECLARE u uuid := gen_random_uuid(); held uuid := gen_random_uuid(); fault uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); deadline timestamptz; old_deadline timestamptz := now()-interval '1 day';
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (u,u::text||'@example.invalid'),(held,held::text||'@example.invalid'),(fault,fault::text||'@example.invalid');
  INSERT INTO public.account_profiles(user_id,display_name) VALUES
    (u,'Synthetic retention'),(held,'Synthetic held retention'),(fault,'Synthetic fault')
    ON CONFLICT(user_id) DO NOTHING;
  UPDATE public.account_profiles SET legal_hold=true WHERE user_id=held;
  INSERT INTO public.kyc_artifacts(id,user_id,step_type,r2_key,content_type,file_size_bytes,status)
    VALUES(a,u,'id_doc','synthetic-retention/'||a::text,'image/jpeg',1,'pending');
  INSERT INTO public.kyc_artifacts(user_id,step_type,r2_key,content_type,file_size_bytes,status,purge_after)
    VALUES(u,'selfie','synthetic-existing/'||u::text,'image/jpeg',1,'approved',old_deadline);
  -- Reviewer-last and location-last both finish through this profile write.
  UPDATE public.account_profiles SET account_verification_status='verified' WHERE user_id=u;
  SELECT purge_after INTO deadline FROM public.kyc_artifacts WHERE id=a;
  IF deadline IS NULL OR deadline < now()+interval '29 days' OR deadline > now()+interval '31 days'
    THEN RAISE EXCEPTION 'Missing transactional deadline'; END IF;
  IF (SELECT purge_after FROM public.kyc_artifacts WHERE r2_key='synthetic-existing/'||u::text)<>old_deadline
    THEN RAISE EXCEPTION 'Existing deadline changed'; END IF;
  UPDATE public.account_profiles SET account_verification_status='verified' WHERE user_id=u;
  IF (SELECT purge_after FROM public.kyc_artifacts WHERE id=a)<>deadline
    THEN RAISE EXCEPTION 'Retry extended deadline'; END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE target_id=u AND action='kyc_purge_scheduled')<>1
    THEN RAISE EXCEPTION 'Missing/duplicate transactional audit'; END IF;
  INSERT INTO public.kyc_artifacts(user_id,step_type,r2_key,content_type,file_size_bytes,status)
    VALUES(fault,'id_doc','synthetic-fault/'||fault::text,'image/jpeg',1,'pending');
  BEGIN
    UPDATE public.account_profiles SET account_verification_status='verified' WHERE user_id=fault;
    RAISE EXCEPTION 'FAULT WAS NOT RAISED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'synthetic schedule failure' THEN RAISE; END IF;
  END;
  IF (SELECT account_verification_status FROM public.account_profiles WHERE user_id=fault)='verified'
    THEN RAISE EXCEPTION 'Scheduling failure committed verified status'; END IF;
  INSERT INTO public.kyc_artifacts(user_id,step_type,r2_key,content_type,file_size_bytes,status)
    VALUES(held,'id_doc','synthetic-held/'||held::text,'image/jpeg',1,'approved');
  INSERT INTO public.verification_steps(user_id,step_type,status,reviewed_at)
    VALUES(fault,'phone','approved',now()),(fault,'location','approved',now()),
      (fault,'id_doc','approved',now()),(fault,'selfie','pending',NULL);
  BEGIN
    UPDATE public.verification_steps SET status='approved',reviewed_at=now()
      WHERE user_id=fault AND step_type='selfie';
    RAISE EXCEPTION 'FINAL STEP FAULT WAS NOT RAISED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'synthetic schedule failure' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.verification_steps WHERE user_id=fault AND step_type='selfie')<>'pending'
    THEN RAISE EXCEPTION 'Final approval was not rolled back for safe ordinary retry'; END IF;
  ALTER TABLE public.kyc_artifacts DISABLE TRIGGER audit_test_fail_retention;
  UPDATE public.verification_steps SET status='approved',reviewed_at=now()
    WHERE user_id=fault AND step_type='selfie';
  IF NOT EXISTS(SELECT 1 FROM public.kyc_artifacts WHERE user_id=fault AND purge_after IS NOT NULL)
    THEN RAISE EXCEPTION 'Derived verified status lacks retention'; END IF;
  ALTER TABLE public.kyc_artifacts ENABLE TRIGGER audit_test_fail_retention;
  UPDATE public.account_profiles SET account_verification_status='verified' WHERE user_id=held;
  IF NOT EXISTS(SELECT 1 FROM public.kyc_artifacts WHERE user_id=held AND purge_after IS NOT NULL)
    THEN RAISE EXCEPTION 'Hold suppressed scheduling'; END IF;
  UPDATE public.kyc_artifacts SET purge_after=now()-interval '1 day' WHERE user_id IN (u,held);
  PERFORM public.run_kyc_retention();
  PERFORM public.run_kyc_retention();
  IF EXISTS(SELECT 1 FROM public.kyc_artifacts WHERE user_id=held AND purged_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Held evidence purged'; END IF;
  IF (SELECT count(*) FROM public.r2_cleanup_queue WHERE r2_key='synthetic-retention/'||a::text)<>1
    THEN RAISE EXCEPTION 'Missing/duplicate object cleanup'; END IF;
  IF has_function_privilege('anon','public.schedule_verified_kyc_retention()','EXECUTE')
    OR has_function_privilege('authenticated','public.schedule_verified_kyc_retention()','EXECUTE')
    THEN RAISE EXCEPTION 'Browser can execute trigger helper'; END IF;
END; $$;
ROLLBACK;
