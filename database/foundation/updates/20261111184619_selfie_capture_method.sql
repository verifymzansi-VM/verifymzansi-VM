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
--    a proof: nothing grants, approves or scores anything from them.
--    Constraints keep them consistent: both set or both empty, only on a
--    selfie, and a passed liveness challenge only with the camera. Earlier
--    receipts stay empty ("not recorded").
-- 2. New member command api.record_my_selfie_capture(request, method,
--    liveness): the website calls it with the member's own session, after
--    reserving the selfie upload and before completing it. It stores the
--    browser's answer on the member's own selfie receipt while that upload is
--    not completed (a later call before completion replaces it; a call after
--    completion changes nothing). It runs with the member's authority because
--    the answer is the member's browser's to give: calling it directly gives
--    a member no more than sending the form would.
-- 3. New staff read api.get_frontend_staff_selfie_capture(case, claim
--    generation, claim nonce): for an open identity case the caller holds under
--    a current live claim (staff with evidence:view, never their own case), it
--    returns the current submission, its selfie and the recorded answer (null
--    when not recorded). It opens no evidence and adds no access log row (the
--    staff evidence metadata read that the viewer makes first records the
--    access); the answer is review context, not identity evidence.
-- 4. internal.scrub_frontend_verification_receipt, which clears the ID number
--    receipt when an evidence file is deleted, also clears the answer, so it
--    goes when the selfie file goes (30 days after the case decision).
-- No existing API command changes signature, grant or owner, so the website
-- deployed before this update keeps working with it, and can be redeployed.
--
-- ORDER: apply this update BEFORE the website release that uses it (the pull
-- request that adds this file) is deployed, so before merging it: that release
-- calls the two new commands, and the deploy preflight probes them.
-- Read-only preflight:
-- ../preflight/20261111184619_selfie_capture_method.check.sql.
-- Rollback: ../rollback/20261111184619_selfie_capture_method.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Preconditions: the receipt scrub is the reviewed body (or already this
-- update's).
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.scrub_frontend_verification_receipt()'))
      is null
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.scrub_frontend_verification_receipt()'))
      not in('a2bcb31f73b232d41b605c4b8b51b155','8e9a4a32bfe4f789bb94d74edf6d4f76') then
    raise exception 'receipt scrub drift: internal.scrub_frontend_verification_receipt is not the reviewed body' using errcode='55000';
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

CREATE OR REPLACE FUNCTION internal.scrub_frontend_verification_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$begin
  if new.state='deleted' then update private.frontend_verification_uploads set fingerprint=null,encrypted_number=null,
    capture_method=null,browser_liveness_passed=null where artifact_id=new.id; end if;
  return new;
end$function$;
alter function internal.scrub_frontend_verification_receipt() owner to postgres;
revoke all on function internal.scrub_frontend_verification_receipt() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.record_my_selfie_capture(p_request uuid, p_capture_method text, p_browser_liveness_passed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); r private.frontend_verification_uploads;
begin
  -- How the browser says the selfie was taken: review context for staff, never
  -- authority. Both values, from the closed set.
  if p_request is null or p_capture_method is null or p_capture_method not in('camera','file_upload')
    or p_browser_liveness_passed is null or (p_browser_liveness_passed and p_capture_method<>'camera') then
    raise exception 'browser capture report invalid' using errcode='22023'; end if;
  perform internal.lock_verification_subject(actor);
  select u.* into r from private.frontend_verification_uploads u where u.owner_id=actor and u.request_id=p_request for update;
  if not found or r.purpose<>'selfie' then raise exception 'selfie upload request required' using errcode='22023'; end if;
  -- A completed upload keeps the answer it was completed with.
  if r.completed_at is not null then return jsonb_build_object('recorded',false); end if;
  if r.expires_at<=clock_timestamp() then raise exception 'upload request changed or expired' using errcode='PT409'; end if;
  update private.frontend_verification_uploads set capture_method=p_capture_method,browser_liveness_passed=p_browser_liveness_passed
    where owner_id=actor and request_id=p_request;
  perform internal.price_draft_actor();
  return jsonb_build_object('recorded',true);
end$function$;
alter function internal.record_my_selfie_capture(uuid,text,boolean) owner to postgres;
revoke all on function internal.record_my_selfie_capture(uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.record_my_selfie_capture(uuid,text,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.record_my_selfie_capture(p_request uuid, p_capture_method text, p_browser_liveness_passed boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
 select internal.record_my_selfie_capture(p_request,p_capture_method,p_browser_liveness_passed);
$function$;
alter function api.record_my_selfie_capture(uuid,text,boolean) owner to postgres;
revoke all on function api.record_my_selfie_capture(uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function api.record_my_selfie_capture(uuid,text,boolean) to authenticated;

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
