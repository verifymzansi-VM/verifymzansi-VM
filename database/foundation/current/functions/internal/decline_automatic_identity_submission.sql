-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.decline_automatic_identity_submission(p_check uuid, p_submission uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare now_at timestamptz:=clock_timestamp();
begin
  delete from private.verification_current_submissions v where v.submission_id=p_submission;
  update private.identity_checks set status='declined',declined_at=now_at,finished_at=now_at,submission_id=p_submission,
    provider_delete_due=now_at+interval '5 days' where id=p_check and status='started';
  if not found then raise exception 'identity check changed' using errcode='PT409'; end if;
end$function$;
alter function internal.decline_automatic_identity_submission(uuid,uuid) owner to postgres;
revoke all on function internal.decline_automatic_identity_submission(uuid,uuid) from public;
