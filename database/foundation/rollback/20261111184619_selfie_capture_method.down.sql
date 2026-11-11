-- Reviewed rollback for updates/20261111184619_selfie_capture_method.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Revert (and deploy) the website
-- release that uses the update first: this rollback removes the two commands
-- that release calls, api.record_my_selfie_capture and
-- api.get_frontend_staff_selfie_capture. The website release before it does
-- not use them and passes the deploy preflight with or without the update.
-- The rollback restores internal.scrub_frontend_verification_receipt byte for
-- byte and drops the capture_method and browser_liveness_passed columns, with
-- every answer recorded so far. Upload receipts and evidence are otherwise
-- unchanged.
begin;
set local lock_timeout='5s';

do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.scrub_frontend_verification_receipt()')) is distinct from '8e9a4a32bfe4f789bb94d74edf6d4f76'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_my_selfie_capture(uuid,text,boolean)')) is distinct from '4ad4bbe1cfe3f8276dfd73e113c34f2f'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_my_selfie_capture(uuid,text,boolean)')) is distinct from '5a227ba0cea8a58d5d0e55a35f2d6afb'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_staff_selfie_capture(uuid,text,uuid)')) is distinct from '409db62cee2182fa6151df48406dc394'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_frontend_staff_selfie_capture(uuid,text,uuid)')) is distinct from '774a7b78891fffc1758eb1ce34728c17' then
    raise exception 'rollback precondition: the selfie capture method update is not applied' using errcode='55000';
  end if;
end$$;

drop function api.get_frontend_staff_selfie_capture(uuid,text,uuid);
drop function internal.get_frontend_staff_selfie_capture(uuid,text,uuid);
drop function api.record_my_selfie_capture(uuid,text,boolean);
drop function internal.record_my_selfie_capture(uuid,text,boolean);

-- The receipt scrub as it was before the update.
CREATE OR REPLACE FUNCTION internal.scrub_frontend_verification_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$begin
  if new.state='deleted' then update private.frontend_verification_uploads set fingerprint=null,encrypted_number=null where artifact_id=new.id; end if;
  return new;
end$function$;
alter function internal.scrub_frontend_verification_receipt() owner to postgres;
revoke all on function internal.scrub_frontend_verification_receipt() from public,anon,authenticated,service_role;

alter table private.frontend_verification_uploads
  drop constraint frontend_verification_uploads_capture_report_check,
  drop constraint frontend_verification_uploads_capture_method_check,
  drop column browser_liveness_passed,
  drop column capture_method;
commit;
