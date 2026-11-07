-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.process_frontend_privacy_request(p_case uuid, p_revision integer, p_action text, p_note text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_attestation text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;rule private.privacy_request_rules;now_at timestamptz;
  answer text;delivery text;note text;verified_subject uuid;matches integer;
begin
  if p_action is null or p_action not in('assign','extend','verify_identity','approve','reject','complete')
    or p_revision is null or p_revision not between 1 and 2147483646 then raise exception 'represented privacy request required' using errcode='22023';end if;
  if p_note is not null then note:=internal.privacy_text(p_note,1,2000);end if;
  select * into r from private.privacy_requests where id=p_case for update;
  if not found or r.revision<>p_revision or r.status not in('submitted','identity_pending','in_progress') then raise exception 'privacy request changed' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');now_at:=clock_timestamp();
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must process your request' using errcode='42501';end if;
  if p_action='assign' then
    if p_assignee is not null and (p_assignee=r.subject_user_id or not exists(
      select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='dsar:manage'
      join private.current_account_access a on a.id=s.user_id join auth.users u on u.id=s.user_id
      where s.user_id=p_assignee and s.revoked_at is null and lower(u.email)<>lower(r.requester_email)))
      then raise exception 'eligible staff assignee required' using errcode='22023';end if;
    update private.privacy_requests set assigned_to=p_assignee,revision=revision+1 where id=r.id;
    answer:=case when p_assignee is null then 'unassigned' else 'assigned' end;
  elsif p_action='extend' then
    select * into rule from private.privacy_request_rules where request_type=r.type;
    if rule.extension_days=0 or r.extended_due_at is not null or r.due_by<=now_at then raise exception 'deadline cannot be extended' using errcode='PT409';end if;
    note:=internal.privacy_text(p_note,10,1000);
    r.extended_due_at:=r.due_by+make_interval(days=>rule.extension_days);
    update private.privacy_requests set extended_due_at=r.extended_due_at,extension_reason=note,processed_by=actor,revision=revision+1 where id=r.id;
    answer:='extended';delivery:=answer;
  elsif p_action='verify_identity' then
    if r.identity_verified then raise exception 'identity was already reviewed' using errcode='PT409';end if;
    if r.identity_check='manual' then
      select count(*),(array_agg(u.id order by u.id))[1] into matches,verified_subject from auth.users u
        where lower(u.email)=lower(r.requester_email) and u.email_confirmed_at is not null and u.deleted_at is null and not u.is_anonymous;
      if matches<>1 then verified_subject:=null;end if;
    else verified_subject:=r.subject_user_id;end if;
    update private.privacy_requests set identity_verified=true,verified_at=now_at,verified_by=actor,
      subject_user_id=verified_subject,processed_by=actor,revision=revision+1 where id=r.id;
    answer:='identity_verified';
  elsif p_action in('approve','reject') then
    if r.status not in('submitted','identity_pending') then raise exception 'privacy request already decided' using errcode='PT409';end if;
    answer:=case p_action when 'approve' then 'in_progress' else 'rejected' end;
    if answer='rejected' then delivery:=answer;end if;
    update private.privacy_requests set status=answer,response_summary=note,processed_by=actor,revision=revision+1 where id=r.id;
  else
    if r.status<>'in_progress' or not r.identity_verified then raise exception 'verified in-progress privacy request required' using errcode='PT409';end if;
    if r.type='deletion' then
      note:=concat_ws(E'\n\n',note,'Deletion attestation: '||internal.privacy_text(p_attestation,10,2000));
    elsif p_attestation is not null then raise exception 'attestation applies only to deletion' using errcode='22023';end if;
    update private.privacy_requests set status='completed',response_summary=note,processed_by=actor,completed_at=now_at,revision=revision+1 where id=r.id;
    answer:='completed';delivery:=answer;
  end if;
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision)
    values(r.id,actor,case answer when 'in_progress' then 'started' else answer end,p_revision);
  if delivery is not null then insert into private.privacy_notice_jobs(request_id,kind) values(r.id,delivery);end if;
  perform internal.staff_actor('dsar:manage');
  return jsonb_build_object('id',r.id,'status',answer,'due',case when answer='extended' then r.extended_due_at end);
end$function$;
alter function internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) owner to postgres;
revoke all on function internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) from public;
grant execute on function internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) to authenticated;
