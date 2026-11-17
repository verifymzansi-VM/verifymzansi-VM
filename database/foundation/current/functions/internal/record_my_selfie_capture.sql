-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
revoke all on function internal.record_my_selfie_capture(uuid,text,boolean) from public;
grant execute on function internal.record_my_selfie_capture(uuid,text,boolean) to authenticated;
