-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.prepare_frontend_privacy_export(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;data jsonb;
  new_export uuid:=gen_random_uuid();
begin
  -- The row lock makes the limits below count one export at a time.
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
      and e.action in('export_prepared','export_refused') and e.occurred_at>clock_timestamp()-interval '1 hour')>=10
    then raise exception 'export preparation limit reached' using errcode='PT429';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.action='exported')>=5
    then raise exception 'export limit for this request reached' using errcode='PT429';end if;
  begin
    data:=case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end;
  exception when sqlstate 'PT413' then data:=null;
  end;
  perform internal.staff_actor('dsar:manage');
  if data is null then
    -- Recorded (not raised) so that the build counts toward the limit.
    insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
      values(r.id,actor,'export_refused',r.revision,new_export);
    return jsonb_build_object('request_id',r.id,'export_id',new_export,'refused','too_large');
  end if;
  -- Staff audit: who prepared which export, and its digest for the
  -- confirmation. The member is told nothing yet.
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id,export_digest)
    values(r.id,actor,'export_prepared',r.revision,new_export,encode(sha256(convert_to(data::text,'UTF8')),'hex'));
  return jsonb_build_object('request_id',r.id,'export_id',new_export,'reference','DSAR-'||upper(left(r.id::text,8)),
    'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,
    'datasets',(select coalesce(jsonb_agg(k order by k),'[]'::jsonb) from jsonb_object_keys(data) k));
end$function$;
alter function internal.prepare_frontend_privacy_export(uuid,integer) owner to postgres;
revoke all on function internal.prepare_frontend_privacy_export(uuid,integer) from public;
grant execute on function internal.prepare_frontend_privacy_export(uuid,integer) to authenticated;
