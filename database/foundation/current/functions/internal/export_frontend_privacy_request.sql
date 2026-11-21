-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.export_frontend_privacy_request(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;result jsonb;bell boolean;notice uuid;
begin
  select * into r from private.privacy_requests where id=p_case for no key update;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or not r.identity_verified
      or not (r.status='in_progress' or (r.status='completed' and r.completed_at>clock_timestamp()-interval '696 hours'
        and r.minimised_at is null))
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  -- A member who cannot see the bell (no account access, or a deleted
  -- account) is told only by email: no export unless that email can be
  -- delivered under the email job's own rule.
  if r.subject_user_id is not null and not exists(select 1 from private.current_account_access a where a.id=r.subject_user_id)
      and not internal.privacy_notice_deliverable(r)
    then raise exception 'The member can''t be notified right now, so nothing was exported. Contact the member and update the request first.'
      using errcode='55000', detail='member_not_notifiable';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.actor_id=actor
      and e.action='exported' and e.occurred_at>clock_timestamp()-interval '1 hour')>=10
    then raise exception 'export limit reached' using errcode='PT429';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.action='exported')>=5
    then raise exception 'export limit for this request reached' using errcode='PT429';end if;
  result:=jsonb_build_object('request_id',r.id,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',clock_timestamp(),'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,
    'datasets',case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end);
  perform internal.staff_actor('dsar:manage');
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,actor,'exported',r.revision);
  -- The member is told of every export. The account the request names gets
  -- a bell notice; the insert must return its row, so a trigger or rule that
  -- drops it aborts the whole export. The requester is emailed: once per
  -- request while the account can sign in (and so see the bell), on every
  -- export otherwise (no account, or closed, banned, suspended or
  -- restricted): a delivered (or abandoned) email is armed again, one still
  -- waiting covers this export too.
  bell:=r.subject_user_id is not null and exists(select 1 from private.current_account_access a where a.id=r.subject_user_id);
  insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported')
    on conflict(request_id,kind) do update set delivered_at=null,attempts=0,next_attempt_at=clock_timestamp(),
      claim_token=null,locked_until=null
    where not bell and (privacy_notice_jobs.delivered_at is not null or (privacy_notice_jobs.attempts>=8
      and (privacy_notice_jobs.locked_until is null or privacy_notice_jobs.locked_until<clock_timestamp())));
  if not bell and not exists(select 1 from private.privacy_notice_jobs j where j.request_id=r.id and j.kind='exported'
      and j.delivered_at is null and j.attempts<8)
    then raise exception 'export email could not be queued' using errcode='55000';end if;
  if r.subject_user_id is not null then
    insert into private.notifications(account_id,kind,subject_id) values(r.subject_user_id,'privacy_export_made',r.id)
      returning id into notice;
    if notice is null then raise exception 'export notice could not be recorded' using errcode='55000';end if;
    perform internal.signal_owner_inbox(r.subject_user_id);
  end if;
  return result;
end$function$;
alter function internal.export_frontend_privacy_request(uuid,integer) owner to postgres;
revoke all on function internal.export_frontend_privacy_request(uuid,integer) from public;
grant execute on function internal.export_frontend_privacy_request(uuid,integer) to authenticated;
