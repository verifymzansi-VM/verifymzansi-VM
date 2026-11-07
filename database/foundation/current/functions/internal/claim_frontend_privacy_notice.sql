-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_frontend_privacy_notice()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare now_at timestamptz:=clock_timestamp();result jsonb;
begin
  with due as (
    select j.id from private.privacy_notice_jobs j join private.privacy_requests r on r.id=j.request_id
    where j.delivered_at is null and j.attempts<8 and j.next_attempt_at<=now_at
      and (j.locked_until is null or j.locked_until<now_at)
      and (r.identity_check='manual' or exists(select 1 from auth.users u where u.id=r.subject_user_id and u.email_confirmed_at is not null
        and not u.is_anonymous and u.deleted_at is null and lower(u.email)=lower(r.requester_email)))
    order by j.next_attempt_at,j.id limit 1 for update of j skip locked
  ), claimed as (
    update private.privacy_notice_jobs j set claim_token=gen_random_uuid(),locked_until=now_at+interval '90 seconds',attempts=attempts+1
    from due where j.id=due.id returning j.*
  )
  select jsonb_build_object('id',j.id,'request_id',r.id,'kind',j.kind,'recipient',r.requester_email,'claim_token',j.claim_token,'locked_until',j.locked_until,
    'due',case when j.kind='extended' then r.extended_due_at when j.kind='submitted' then r.due_by end,
    'reason',case when j.kind='extended' then r.extension_reason end)
    into result from claimed j join private.privacy_requests r on r.id=j.request_id;
  return result;
end$function$;
alter function internal.claim_frontend_privacy_notice() owner to postgres;
revoke all on function internal.claim_frontend_privacy_notice() from public;
grant execute on function internal.claim_frontend_privacy_notice() to service_role;
