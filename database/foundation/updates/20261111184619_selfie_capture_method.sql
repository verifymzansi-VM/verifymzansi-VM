-- Staff see how each selfie was taken.
--
-- The verification page sends, with the selfie, how the browser says it was
-- taken: "camera" (the live camera step) or "file_upload" (the "Or upload a
-- photo" fallback), and whether the browser's liveness challenge was completed.
-- Until now the website dropped both, so the staff identity viewer could never
-- show its "Uploaded file" warning.
--
-- From this update:
-- 1. private.frontend_verification_uploads gains two nullable columns on the
--    selfie's upload receipt: capture_method ('camera' or 'file_upload') and
--    browser_liveness_passed. Both are what the member's browser reported, not
--    a proof: the website checks them against this closed set and nothing
--    grants, approves or scores anything from them. Constraints keep them
--    consistent: both set or both empty, only on a selfie, and a passed
--    liveness challenge only with the camera. Earlier receipts stay empty
--    ("not recorded").
-- 2. api.complete_frontend_verification_upload (service role only) gains two
--    optional arguments, p_capture_method and p_browser_liveness_passed, which
--    it validates and stores on the selfie receipt in the same statement that
--    completes it. Callers that leave them out (the website deployed before this
--    update) keep working and store nothing. A retry of a completed upload
--    changes nothing, as before. The old seven-argument function is dropped and
--    recreated with the two extra optional arguments in this transaction, so
--    exactly one function answers both forms of the call; its grants are the
--    same (service role only).
-- 3. New staff read api.get_frontend_staff_selfie_capture(case, claim
--    generation, claim nonce): for an open identity case the caller holds under
--    a current live claim (staff with evidence:view, never their own case), it
--    returns the current submission, its selfie and the recorded capture method
--    and liveness answer (null when not recorded). It reads no evidence object
--    and adds no access log row (the staff evidence metadata read that the
--    viewer makes first records the access).
-- The values follow the receipt's retention: they are removed with it when the
-- selfie's evidence record or its case is deleted.
--
-- ORDER: apply this update BEFORE the website release that sends these values
-- (the pull request that adds this file) is deployed, so before merging it: that
-- release calls the new staff read and passes the new arguments, and the
-- deploy preflight probes the new read. The website deployed before it keeps
-- working with the update applied.
-- Read-only preflight:
-- ../preflight/20261111184619_selfie_capture_method.check.sql.
-- Rollback: ../rollback/20261111184619_selfie_capture_method.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Preconditions: the upload completion is the reviewed seven-argument body (the
-- update replaces it) or already this update's nine-argument one, never both.
do $$begin
  if to_regprocedure('internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer)') is not null then
    if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer)'))
        is distinct from '737041e48e8be2f17d7eb0e4a3dd2ba3'
      or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer)'))
        is distinct from '4bd0236e450555b0340a319891244e87' then
      raise exception 'upload completion drift: complete_frontend_verification_upload is not the reviewed body' using errcode='55000';
    end if;
    if to_regprocedure('internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)') is not null then
      raise exception 'upload completion drift: both forms of complete_frontend_verification_upload exist' using errcode='55000';
    end if;
  elsif to_regprocedure('internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)') is null
    or to_regprocedure('api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)') is null then
    raise exception 'upload completion drift: complete_frontend_verification_upload is missing' using errcode='55000';
  elsif (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)'))
      is distinct from 'edd196d8ef77532f8f07fd4a02ca9c4f'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)'))
      is distinct from '4a17f8bbad56ecd3191a72d45287511e' then
    raise exception 'upload completion drift: complete_frontend_verification_upload is not this update''s body' using errcode='55000';
  end if;
end$$;

alter table private.frontend_verification_uploads
  add column if not exists capture_method text,
  add column if not exists browser_liveness_passed boolean;
alter table private.frontend_verification_uploads
  drop constraint if exists frontend_verification_uploads_capture_method_check,
  add constraint frontend_verification_uploads_capture_method_check
    check(capture_method=any(array['camera'::text,'file_upload'::text])),
  drop constraint if exists frontend_verification_uploads_capture_report_check,
  add constraint frontend_verification_uploads_capture_report_check
    check((capture_method is null)=(browser_liveness_passed is null)
      and (purpose='selfie' or capture_method is null)
      and (browser_liveness_passed is not true or capture_method='camera'));
comment on column private.frontend_verification_uploads.capture_method is
  'Selfie only: how the member''s browser says the photo was taken (camera or file_upload). Browser-reported review context, not a proof; null when not recorded.';
comment on column private.frontend_verification_uploads.browser_liveness_passed is
  'Selfie only: whether the member''s browser says its liveness challenge was completed. Browser-reported review context, not a proof; null when not recorded.';

drop function if exists api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer);
drop function if exists internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer);

CREATE OR REPLACE FUNCTION internal.complete_frontend_verification_upload(p_owner uuid, p_request uuid, p_stored_sha256 text, p_content_sha256 text, p_size integer, p_identity jsonb DEFAULT NULL::jsonb, p_risk_score integer DEFAULT NULL::integer, p_capture_method text DEFAULT NULL::text, p_browser_liveness_passed boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare ctx jsonb; r private.frontend_verification_uploads; id private.frontend_verification_uploads; done jsonb; submitted jsonb;
begin
  ctx:=internal.frontend_verification_upload_context(p_owner,p_request);
  if (ctx->>'completed')::boolean then return ctx; end if;
  select * into r from private.frontend_verification_uploads where owner_id=p_owner and request_id=p_request;
  -- How the browser says the selfie was taken: review context for staff, never
  -- authority. Only a selfie carries it; both values or neither.
  if (p_capture_method is null)<>(p_browser_liveness_passed is null)
    or (p_capture_method is not null and (r.purpose<>'selfie' or p_capture_method not in('camera','file_upload')
      or (p_browser_liveness_passed and p_capture_method<>'camera'))) then
    raise exception 'browser capture report invalid' using errcode='22023'; end if;
  if r.purpose='id_front' then
    if p_identity is null or jsonb_typeof(p_identity)<>'object' or p_identity-array['fingerprint','encrypted_number']<>'{}'::jsonb
      or not(p_identity ?& array['fingerprint','encrypted_number'])
      or jsonb_typeof(p_identity->'fingerprint') is distinct from 'string'
      or p_identity->>'fingerprint' !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      or jsonb_typeof(p_identity->'encrypted_number') is distinct from 'object'
      or (p_identity->'encrypted_number')-array['ciphertext','iv','tag','key_id']<>'{}'::jsonb
      or not(p_identity->'encrypted_number' ?& array['ciphertext','iv','tag','key_id'])
      or jsonb_typeof(p_identity->'encrypted_number'->'ciphertext') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'iv') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'tag') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'key_id') is distinct from 'string'
      or p_identity->'encrypted_number'->>'ciphertext' !~ '^[a-f0-9]{26}$'
      or p_identity->'encrypted_number'->>'iv' !~ '^[a-f0-9]{24}$'
      or p_identity->'encrypted_number'->>'tag' !~ '^[a-f0-9]{32}$'
      or p_identity->'encrypted_number'->>'key_id' is distinct from 'identity-number-v1' then
      raise exception 'encrypted identity receipt required' using errcode='22023'; end if;
  elsif p_identity is not null or p_risk_score is null or p_risk_score not between 0 and 100 then
    raise exception 'server assessment required' using errcode='22023';
  end if;
  done:=internal.complete_evidence_upload(r.artifact_id,p_stored_sha256,p_content_sha256,p_size);
  if r.purpose='selfie' then
    select * into id from private.frontend_verification_uploads where owner_id=p_owner and request_id=r.id_request;
    submitted:=internal.register_identity_submission(r.case_id,(done->>'case_version')::integer,id.artifact_id,r.artifact_id,
      id.fingerprint,'identity-match-v1',id.encrypted_number,r.request_id,p_risk_score);
    update private.frontend_verification_uploads set fingerprint=null,encrypted_number=null
      where owner_id=p_owner and request_id=r.id_request;
  end if;
  update private.frontend_verification_uploads set completed_at=clock_timestamp(),
    fingerprint=case when r.purpose='id_front' then p_identity->>'fingerprint' end,
    encrypted_number=case when r.purpose='id_front' then p_identity->'encrypted_number' end,
    capture_method=case when r.purpose='selfie' then p_capture_method end,
    browser_liveness_passed=case when r.purpose='selfie' then p_browser_liveness_passed end,
    submission_id=(submitted->>'submission_id')::uuid where owner_id=p_owner and request_id=p_request;
  -- Session revocation during an in-flight object write must prevent submission.
  if not exists(select 1 from auth.sessions s where s.id=r.session_id and s.user_id=p_owner
    and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'upload session expired' using errcode='42501'; end if;
  return jsonb_build_object('completed',true,'artifact_id',r.artifact_id,'purpose',r.purpose);
end$function$;
alter function internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean) owner to postgres;
revoke all on function internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean) to service_role;

CREATE OR REPLACE FUNCTION api.complete_frontend_verification_upload(p_owner uuid, p_request uuid, p_stored_sha256 text, p_content_sha256 text, p_size integer, p_identity jsonb DEFAULT NULL::jsonb, p_risk_score integer DEFAULT NULL::integer, p_capture_method text DEFAULT NULL::text, p_browser_liveness_passed boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
 select internal.complete_frontend_verification_upload(p_owner,p_request,p_stored_sha256,p_content_sha256,p_size,p_identity,p_risk_score,p_capture_method,p_browser_liveness_passed);
$function$;
alter function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean) owner to postgres;
revoke all on function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean) from public,anon,authenticated,service_role;
grant execute on function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean) to service_role;

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_selfie_capture(p_case_id uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view'); c private.evidence_cases;
  s private.verification_identity_submissions; r private.frontend_verification_uploads;
begin
  if p_case_id is null then raise exception 'case unavailable' using errcode='22023'; end if;
  select e.* into c from private.evidence_cases e where e.id=p_case_id;
  if not found or c.kind<>'kyc' or c.status<>'open' then raise exception 'case unavailable' using errcode='22023'; end if;
  -- The caller holds this case now, under a live claim, and it is not theirs.
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  select x.* into s from private.verification_identity_submissions x join private.verification_current_submissions v
    on v.submission_id=x.id and v.case_id=c.id;
  if not found or s.case_version<>c.version or s.owner_id<>c.subject_id then
    raise exception 'current submission unavailable' using errcode='PT409'; end if;
  -- The selfie's upload receipt, when the website recorded one; null fields
  -- mean "not recorded".
  select u.* into r from private.frontend_verification_uploads u
    where u.owner_id=c.subject_id and u.case_id=c.id and u.submission_id=s.id and u.purpose='selfie'
      and u.artifact_id=s.selfie_artifact_id and u.completed_at is not null;
  return jsonb_build_object('case_id',c.id,'case_version',c.version,'submission_id',s.id,
    'selfie_artifact_id',s.selfie_artifact_id,'capture_method',r.capture_method,
    'browser_liveness_passed',r.browser_liveness_passed);
end$function$;
alter function internal.get_frontend_staff_selfie_capture(uuid,text,uuid) owner to postgres;
revoke all on function internal.get_frontend_staff_selfie_capture(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_staff_selfie_capture(uuid,text,uuid) to authenticated;

CREATE OR REPLACE FUNCTION api.get_frontend_staff_selfie_capture(p_case_id uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
 select internal.get_frontend_staff_selfie_capture(p_case_id,p_claim_generation,p_claim_nonce);
$function$;
alter function api.get_frontend_staff_selfie_capture(uuid,text,uuid) owner to postgres;
revoke all on function api.get_frontend_staff_selfie_capture(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_staff_selfie_capture(uuid,text,uuid) to authenticated;
commit;
