-- Native PostgreSQL synthetic data only, always rolled back.
BEGIN;
DO $$
DECLARE u uuid; a uuid; st uuid; i integer; expired integer;
  users uuid[] := '{}'; artifacts uuid[] := '{}';
BEGIN
  FOR i IN 1..9 LOOP
    u:=gen_random_uuid(); a:=gen_random_uuid(); st:=gen_random_uuid();
    users:=array_append(users,u); artifacts:=array_append(artifacts,a);
    INSERT INTO auth.users(id,email) VALUES(u,u::text||'@example.invalid');
    INSERT INTO public.account_profiles(user_id,display_name,legal_hold,account_verification_status)
      VALUES(u,'Synthetic retention case',i=3,CASE WHEN i=4 THEN 'verified'::public.account_verification_status ELSE 'incomplete'::public.account_verification_status END)
      ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name, legal_hold=EXCLUDED.legal_hold, account_verification_status=EXCLUDED.account_verification_status;
    INSERT INTO public.verification_steps(id,user_id,step_type,status,id_number_encrypted,id_number_iv,id_number_tag,id_number_hmac,created_at,updated_at,submitted_at,reviewed_at)
      VALUES(st,u,'id_doc',CASE WHEN i=2 THEN 'approved'::public.verification_status ELSE 'pending'::public.verification_status END,'synthetic','synthetic','synthetic','retained-synthetic-hash',now()-interval '100 days',now()-interval '100 days',now()-interval '100 days',CASE WHEN i=5 THEN now()-interval '1 day' ELSE NULL END);
    INSERT INTO public.kyc_artifacts(id,user_id,step_type,r2_key,content_type,file_size_bytes,status,created_at)
      VALUES(a,u,'id_doc','synthetic-retention/'||a::text,'image/jpeg',1,
        CASE WHEN i=2 THEN 'approved'::public.verification_status ELSE 'pending'::public.verification_status END,now()-interval '100 days');
    INSERT INTO public.verification_sessions(user_id,id_artifact_id,created_at,updated_at) VALUES(u,a,now()-interval '100 days',now()-interval '100 days');
    IF i=6 THEN
      INSERT INTO public.kyc_artifacts(user_id,step_type,r2_key,content_type,file_size_bytes)
        VALUES(u,'selfie','synthetic-recent/'||u::text,'image/jpeg',1);
    ELSIF i=7 THEN
      INSERT INTO public.queue_claims(item_type,item_id,queue,claimed_by,expires_at)
        VALUES('verification_step',st,'kyc',u,now()+interval '10 minutes');
    ELSIF i IN (8,9) THEN
      INSERT INTO public.decision_records(case_type,case_id,action_category,status,recommender_id,recommendation,rationale,expires_at,legal_hold)
        VALUES('verification_step',st::text,'kyc_override','pending_approval',u,'approve','Synthetic only',
          CASE WHEN i=9 THEN now()-interval '1 day' ELSE now()+interval '1 day' END,i=9);
    END IF;
  END LOOP;
  expired:=(public.run_kyc_retention()->>'inactive')::integer;
  IF expired<>2 THEN RAISE EXCEPTION 'Expected pending and partially approved expiry, got %',expired; END IF;
  IF EXISTS(SELECT 1 FROM public.kyc_artifacts WHERE id=ANY(artifacts[3:9]) AND purged_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Hold, verified, review, submission, claim or decision was not preserved'; END IF;
  IF (SELECT count(*) FROM public.verification_sessions WHERE user_id=ANY(users[1:2]) AND id_artifact_id IS NULL)<>2
    THEN RAISE EXCEPTION 'Expired session remains linked'; END IF;
  IF (SELECT count(*) FROM public.verification_steps WHERE user_id=ANY(users[1:2]) AND status='needs_resubmission'
      AND id_number_encrypted IS NULL AND id_number_hmac='retained-synthetic-hash')<>2
    THEN RAISE EXCEPTION 'Resubmission or sensitive-field clearing failed'; END IF;
  IF public.expire_inactive_kyc_submissions()<>0 THEN RAISE EXCEPTION 'Expiry is not idempotent'; END IF;
  IF (SELECT count(*) FROM public.r2_cleanup_queue WHERE r2_key IN
      (SELECT r2_key FROM public.kyc_artifacts WHERE id=ANY(artifacts)) AND reason='inactive_incomplete_kyc_90d')<>2
    THEN RAISE EXCEPTION 'Duplicate or missing byte-removal queue'; END IF;
  IF has_function_privilege('anon','public.expire_inactive_kyc_submissions()','EXECUTE')
    OR has_function_privilege('authenticated','public.expire_inactive_kyc_submissions()','EXECUTE')
    OR NOT has_function_privilege('service_role','public.expire_inactive_kyc_submissions()','EXECUTE')
    THEN RAISE EXCEPTION 'Retention RPC must be service-only'; END IF;
END;
$$;
ROLLBACK;
