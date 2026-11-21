-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.export_frontend_privacy_request(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;result jsonb;
begin
  -- Parallel exports wait for each other; completing the request waits too.
  select * into r from private.privacy_requests where id=p_case for no key update;
  if not found or r.type<>'access'
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  if r.status<>'in_progress'
    then raise exception 'access request is not in progress' using errcode='PT409',detail='privacy_export_not_in_progress';end if;
  if r.revision is distinct from p_revision or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.action='exported')>=5
    then raise exception 'export limit reached for this request' using errcode='PT429',detail='privacy_export_limit';end if;
  result:=jsonb_build_object('request_id',r.id,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',clock_timestamp(),'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,
    'datasets',case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end);
  perform internal.staff_actor('dsar:manage');
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,actor,'exported',r.revision);
  -- The requester is emailed once per request; the account named by the
  -- request gets a bell notice for every export.
  insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported') on conflict(request_id,kind) do nothing;
  if r.subject_user_id is not null then
    perform internal.notify_account(r.subject_user_id,'privacy_export_made',r.id,null,null);
  end if;
  return result;
end$function$;
alter function internal.export_frontend_privacy_request(uuid,integer) owner to postgres;
revoke all on function internal.export_frontend_privacy_request(uuid,integer) from public;
grant execute on function internal.export_frontend_privacy_request(uuid,integer) to authenticated;
