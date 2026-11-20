-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.confirm_frontend_privacy_export(p_case uuid, p_revision integer, p_export uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;
  prepared private.privacy_request_events;done private.privacy_request_events;data jsonb;
begin
  if p_export is null then raise exception 'export id required' using errcode='22023';end if;
  select * into r from private.privacy_requests where id=p_case for share;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or r.status not in('in_progress','completed') or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  select * into prepared from private.privacy_request_events e
    where e.export_id=p_export and e.action='export_prepared' and e.request_id=r.id;
  if not found or prepared.actor_id is distinct from actor or prepared.represented_revision<>r.revision
    then raise exception 'prepared export required' using errcode='PT409';end if;
  if exists(select 1 from private.privacy_request_events e where e.export_id=p_export and e.action='exported')
    then raise exception 'export already confirmed' using errcode='PT409';end if;
  if prepared.occurred_at<clock_timestamp()-interval '15 minutes'
    then raise exception 'prepared export expired' using errcode='PT409';end if;
  -- Built again before anything is recorded (the notice below would change
  -- the notifications dataset); it must be exactly what was prepared.
  data:=case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end;
  if encode(sha256(convert_to(data::text,'UTF8')),'hex') is distinct from prepared.export_digest
    then raise exception 'export changed since it was prepared' using errcode='PT409';end if;
  perform internal.staff_actor('dsar:manage');
  -- A concurrent confirmation of the same export waits here for the first
  -- and then finds its row: it is refused and returns nothing.
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
    values(r.id,actor,'exported',r.revision,p_export)
    on conflict (export_id,action) where export_id is not null do nothing
    returning * into done;
  if done.id is null then raise exception 'export already confirmed' using errcode='PT409';end if;
  -- The requester is told once that an export was made (email), and the
  -- account the request names in its bell.
  insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported') on conflict(request_id,kind) do nothing;
  if found and r.subject_user_id is not null then
    perform internal.notify_account(r.subject_user_id,'privacy_export_made',r.id,null,null);
  end if;
  return jsonb_build_object('request_id',r.id,'export_id',p_export,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',done.occurred_at,'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,'datasets',data);
end$function$;
alter function internal.confirm_frontend_privacy_export(uuid,integer,uuid) owner to postgres;
revoke all on function internal.confirm_frontend_privacy_export(uuid,integer,uuid) from public;
grant execute on function internal.confirm_frontend_privacy_export(uuid,integer,uuid) to authenticated;
