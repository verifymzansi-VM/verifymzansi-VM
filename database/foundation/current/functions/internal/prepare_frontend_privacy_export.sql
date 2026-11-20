-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.prepare_frontend_privacy_export(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;data jsonb;digest text;
  new_export uuid:=gen_random_uuid();
begin
  -- The row lock makes the hourly limit below count one preparation at a time.
  select * into r from private.privacy_requests where id=p_case for update;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or r.status not in('in_progress','completed') or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.actor_id=actor
      and e.action='export_prepared' and e.occurred_at>clock_timestamp()-interval '1 hour')>=10
    then raise exception 'export preparation limit reached' using errcode='PT429';end if;
  data:=case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end;
  digest:=encode(sha256(convert_to(data::text,'UTF8')),'hex');
  perform internal.staff_actor('dsar:manage');
  -- Staff audit only: who prepared which export. The member is told nothing
  -- until the export is confirmed, which is also the only way to its data.
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id,export_digest)
    values(r.id,actor,'export_prepared',r.revision,new_export,digest);
  return jsonb_build_object('request_id',r.id,'export_id',new_export,'reference','DSAR-'||upper(left(r.id::text,8)),
    'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,'digest',digest,
    'datasets',coalesce((select jsonb_object_agg(d.key,jsonb_array_length(d.value)) from jsonb_each(data) d),'{}'::jsonb));
end$function$;
alter function internal.prepare_frontend_privacy_export(uuid,integer) owner to postgres;
revoke all on function internal.prepare_frontend_privacy_export(uuid,integer) from public;
grant execute on function internal.prepare_frontend_privacy_export(uuid,integer) to authenticated;
