-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.confirm_frontend_privacy_export(p_case uuid, p_revision integer, p_export uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;
  prepared private.privacy_request_events;done private.privacy_request_events;data jsonb;bell boolean;notice uuid;
  deliverable boolean;
begin
  if p_export is null then raise exception 'export id required' using errcode='22023';end if;
  -- The row lock makes confirmations of one request (and the limit on them)
  -- happen one at a time.
  select * into r from private.privacy_requests where id=p_case for no key update;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or not r.identity_verified
      or not (r.status='in_progress' or (r.status='completed' and r.completed_at>clock_timestamp()-interval '696 hours'
        and r.minimised_at is null))
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  -- Whether the account the request names can see its bell, and whether the
  -- requester's address can be emailed under the email job's own rule.
  bell:=r.subject_user_id is not null and exists(select 1 from private.current_account_access a where a.id=r.subject_user_id);
  deliverable:=internal.privacy_notice_deliverable(r);
  -- A member who cannot see the bell (no account access, or a deleted
  -- account) is told only by email: no export unless that email can be
  -- delivered.
  if r.subject_user_id is not null and not bell and not deliverable
    then raise exception 'The member can''t be notified right now, so nothing was exported. Contact the member and update the request first.'
      using errcode='55000', detail='member_not_notifiable';end if;
  select * into prepared from private.privacy_request_events e
    where e.export_id=p_export and e.action='export_prepared' and e.request_id=r.id;
  if not found or prepared.actor_id is distinct from actor or prepared.represented_revision<>r.revision
    then raise exception 'prepared export required' using errcode='PT409';end if;
  if exists(select 1 from private.privacy_request_events e where e.export_id=p_export and e.action='exported')
    then raise exception 'export already confirmed' using errcode='PT409';end if;
  if exists(select 1 from private.privacy_request_events e where e.export_id=p_export and e.action='export_refused')
    then raise exception 'prepared export refused' using errcode='PT409';end if;
  if prepared.occurred_at<clock_timestamp()-interval '15 minutes'
    then raise exception 'prepared export expired' using errcode='PT409';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.action='exported')>=5
    then raise exception 'export limit for this request reached' using errcode='PT429';end if;
  -- Built again before anything is recorded (the notice below changes the
  -- notifications dataset); it must be exactly what was prepared.
  begin
    data:=case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end;
  exception when sqlstate 'PT413' then data:=null;
  end;
  perform internal.staff_actor('dsar:manage');
  if data is null or encode(sha256(convert_to(data::text,'UTF8')),'hex') is distinct from prepared.export_digest then
    -- Recorded (not raised): the build counts toward the hourly limit and
    -- this export id cannot be confirmed any more.
    insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
      values(r.id,actor,'export_refused',r.revision,p_export);
    return jsonb_build_object('request_id',r.id,'export_id',p_export,
      'refused',case when data is null then 'too_large' else 'changed' end);
  end if;
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
    values(r.id,actor,'exported',r.revision,p_export)
    on conflict (export_id,action) where export_id is not null do nothing
    returning * into done;
  if done.id is null then raise exception 'export already confirmed' using errcode='PT409';end if;
  -- The member is told of every export. The account the request names gets
  -- a bell notice; the insert must return its row, so a trigger or rule that
  -- drops it aborts the whole export. The requester is emailed: once per
  -- request while the account can sign in (and so see the bell), on every
  -- export otherwise (no account, or closed, banned, suspended or
  -- restricted). A delivered, abandoned, in-flight or part-tried email is
  -- armed again with all its tries (an in-flight one is sent again: its
  -- worker's completion no longer matches the claim; a waiting one keeps its
  -- next try time); one waiting untried covers this export too. An email is
  -- armed only for an address the email job can deliver to: never a job that
  -- can never run (an account that sees its bell but cannot be emailed, a
  -- request whose account is gone, or one with no account and no reviewed
  -- address). One is required only when it can be delivered and nobody sees
  -- a bell.
  if deliverable then
    insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported')
      on conflict(request_id,kind) do update set delivered_at=null,attempts=0,claim_token=null,locked_until=null,
        next_attempt_at=case when privacy_notice_jobs.delivered_at is null and privacy_notice_jobs.claim_token is null
          and privacy_notice_jobs.attempts<8 then privacy_notice_jobs.next_attempt_at else clock_timestamp() end
      where not bell and (privacy_notice_jobs.delivered_at is not null or privacy_notice_jobs.claim_token is not null
        or privacy_notice_jobs.attempts>0);
  end if;
  if deliverable and not bell and not exists(select 1 from private.privacy_notice_jobs j where j.request_id=r.id
      and j.kind='exported' and j.delivered_at is null and j.attempts=0)
    then raise exception 'export email could not be queued' using errcode='55000';end if;
  if r.subject_user_id is not null then
    insert into private.notifications(account_id,kind,subject_id) values(r.subject_user_id,'privacy_export_made',r.id)
      returning id into notice;
    if notice is null then raise exception 'export notice could not be recorded' using errcode='55000';end if;
    perform internal.signal_owner_inbox(r.subject_user_id);
  end if;
  return jsonb_build_object('request_id',r.id,'export_id',p_export,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',done.occurred_at,'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,'datasets',data);
end$function$;
alter function internal.confirm_frontend_privacy_export(uuid,integer,uuid) owner to postgres;
revoke all on function internal.confirm_frontend_privacy_export(uuid,integer,uuid) from public;
grant execute on function internal.confirm_frontend_privacy_export(uuid,integer,uuid) to authenticated;
