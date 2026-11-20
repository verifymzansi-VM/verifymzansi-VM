-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.confirm_frontend_privacy_export(p_case uuid, p_revision integer, p_export uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;
  prepared private.privacy_request_events;done private.privacy_request_events;
begin
  if p_export is null then raise exception 'export id required' using errcode='22023';end if;
  select * into r from private.privacy_requests where id=p_case for share;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or r.status not in('in_progress','completed') or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  select * into prepared from private.privacy_request_events e
    where e.export_id=p_export and e.action='export_prepared' and e.request_id=r.id;
  if not found or prepared.actor_id is distinct from actor or prepared.represented_revision<>r.revision
    then raise exception 'prepared export required' using errcode='PT409';end if;
  -- A confirmed export answers the same again and changes nothing.
  select * into done from private.privacy_request_events e where e.export_id=p_export and e.action='exported';
  if not found then
    if prepared.occurred_at<clock_timestamp()-interval '15 minutes'
      then raise exception 'prepared export expired' using errcode='PT409';end if;
    insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
      values(r.id,actor,'exported',r.revision,p_export)
      on conflict (export_id,action) where export_id is not null do nothing
      returning * into done;
    if done.id is null then
      -- A concurrent confirmation of the same export won; it told the member.
      select * into done from private.privacy_request_events e where e.export_id=p_export and e.action='exported';
    else
      -- The requester is told once that an export was made (email), and the
      -- account the request names in its bell.
      insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported') on conflict(request_id,kind) do nothing;
      if found and r.subject_user_id is not null then
        perform internal.notify_account(r.subject_user_id,'privacy_export_made',r.id,null,null);
      end if;
    end if;
  end if;
  return jsonb_build_object('request_id',r.id,'export_id',p_export,'confirmed_at',done.occurred_at);
end$function$;
alter function internal.confirm_frontend_privacy_export(uuid,integer,uuid) owner to postgres;
revoke all on function internal.confirm_frontend_privacy_export(uuid,integer,uuid) from public;
grant execute on function internal.confirm_frontend_privacy_export(uuid,integer,uuid) to authenticated;
