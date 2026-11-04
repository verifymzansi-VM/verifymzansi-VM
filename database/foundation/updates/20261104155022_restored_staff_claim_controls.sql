-- Typed claim metadata for the selected staff queues. Foreign holders' lease
-- secrets never leave SQL. No source table or service-role authority is added.
begin;
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.lock_evidence_subject(uuid)'::regprocedure)<>'3ef77cf81542607c0ba91f6687255f01' then raise exception 'evidence subject guard drift';end if;
end$$;
create function internal.get_frontend_staff_claims(p_items jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view');items jsonb;own_count bigint;
begin
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>300 then raise exception 'bounded claim subjects required' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object'
      or not(x ? 'type' and x ? 'id') or x-array['type','id']<>'{}'::jsonb
      or jsonb_typeof(x->'type') is distinct from 'string' or jsonb_typeof(x->'id') is distinct from 'string'
      or x->>'type' not in('report','verification_step','listing','business','promotion','content_edit','business_verification')
      or x->>'id' is null or x->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then
    raise exception 'typed claim subjects required' using errcode='22023';end if;
  with all_claims as(
    select coalesce(q.post_id,q.report_id) id,case when q.post_id is not null then 'post' else 'report' end subject,
      case when q.post_id is not null then 'content' else 'reports' end queue,
      case when q.report_id is not null then 'report' when p.edit_of is not null then 'content_edit' when p.kind='event' then 'promotion' else p.kind end item_type,
      q.claimed_by,q.claim_generation,q.claim_nonce,q.claim_expires_at,p.revision,p.edit_of
      from private.queue_claims q left join private.posts p on p.id=q.post_id
      where q.claimed_by is not null and q.claim_expires_at>clock_timestamp()
    union all
    select c.id,'case',case c.kind when 'kyc' then 'kyc' else 'business_kyc' end,
      case c.kind when 'kyc' then 'verification_step' else 'business_verification' end,
      c.claimed_by,c.claim_generation,c.claim_nonce,c.claim_expires_at,c.version,null::uuid
      from private.evidence_cases c where c.kind in('kyc','business') and c.status='open'
      and c.claimed_by is not null and c.claim_expires_at>clock_timestamp()
  ), selected as(
    select c.* from all_claims c where c.claimed_by=actor or exists(select 1 from jsonb_array_elements(p_items) x
      where x->>'type'=c.item_type and x->>'id'=c.id::text) order by c.subject,c.id limit 1301
  ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'subject',c.subject,'queue',c.queue,'item_type',c.item_type,
    'mine',c.claimed_by=actor,'holder_name',case when c.claimed_by=actor then 'you' else 'another moderator' end,
    'generation',case when c.claimed_by=actor then c.claim_generation::text end,
    'nonce',case when c.claimed_by=actor then c.claim_nonce end,
    'expires_at',c.claim_expires_at,'revision',c.revision,'edit_of',c.edit_of) order by c.subject,c.id),'[]'::jsonb),
    (select count(*) from all_claims c where c.claimed_by=actor) into items,own_count from selected c;
  if jsonb_array_length(items)>1300 then raise exception 'too many claim subjects; narrow this view' using errcode='PT409';end if;
  perform internal.staff_actor('queue:view');
  return jsonb_build_object('account_id',actor,'own_count',own_count,'items',items);
end$$;
revoke all on function internal.get_frontend_staff_claims(jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_staff_claims(jsonb) to authenticated;
create function api.get_frontend_staff_claims(p_items jsonb default '[]'::jsonb) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_staff_claims(p_items)$$;
revoke all on function api.get_frontend_staff_claims(jsonb) from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_staff_claims(jsonb) to authenticated;

-- "Keep/Release all my items" intentionally targets the actor's current set,
-- not a browser-selected tuple. Each native command still checks its exact
-- live lease. Any refusal rolls the whole batch back; there is no HTTP replay.
create function internal.control_my_frontend_staff_claims(p_action text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view');snapshot jsonb;r record;n integer:=0;
begin
  if p_action is null or p_action not in('renew','release') then raise exception 'claim action required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,1201));
  snapshot:=internal.get_frontend_staff_claims();
  -- Subject guards precede all work rows, including mixed post/evidence batches.
  for r in select distinct c.subject_id from private.evidence_cases c join jsonb_array_elements(snapshot->'items') x
      on x->>'subject'='case' and (x->>'id')::uuid=c.id order by c.subject_id
  loop perform internal.lock_evidence_subject(r.subject_id);end loop;
  for r in select x->>'subject' subject,(x->>'id')::uuid id,x->>'generation' generation,(x->>'nonce')::uuid nonce
      from jsonb_array_elements(snapshot->'items') x order by x->>'subject',x->>'id'
  loop
    if r.subject='case' then
      if p_action='renew' then perform internal.renew_evidence_claim(r.id,r.generation,r.nonce);
      else perform internal.release_evidence_claim(r.id,r.generation,r.nonce);end if;
      perform internal.staff_actor('case:claim');
    elsif p_action='renew' then perform internal.renew_queue_claim(r.subject,r.id,r.generation,r.nonce);
    else perform internal.release_queue_claim(r.subject,r.id,r.generation,r.nonce);end if;
    n:=n+1;
  end loop;
  perform internal.staff_actor('queue:view');
  return jsonb_build_object(case p_action when 'renew' then 'renewed' else 'released' end,n);
end$$;
revoke all on function internal.control_my_frontend_staff_claims(text) from public,anon,authenticated,service_role;
grant execute on function internal.control_my_frontend_staff_claims(text) to authenticated;
create function api.control_my_frontend_staff_claims(p_action text) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.control_my_frontend_staff_claims(p_action)$$;
revoke all on function api.control_my_frontend_staff_claims(text) from public,anon,authenticated,service_role;
grant execute on function api.control_my_frontend_staff_claims(text) to authenticated;

create function internal.claim_frontend_staff_items(p_queue text,p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid;items jsonb:='[]'::jsonb;answer jsonb;r record;
begin
  if p_queue is null or p_queue not in('content','reports','kyc','business_kyc') or p_limit is null or p_limit not between 1 and 25 then
    raise exception 'bounded staff queue required' using errcode='22023';end if;
  if p_queue in('content','reports') then
    items:=internal.claim_queue_items(p_queue,p_limit);
  else
    actor:=internal.staff_actor('case:claim');
    -- Lock each subject before its evidence case, as the native claim command
    -- does. A busy candidate is skipped; no failed mutation is replayed.
    for r in select c.id,c.subject_id from private.evidence_cases c
      left join private.verification_current_submissions v on v.case_id=c.id
      left join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version
      where c.status='open' and c.kind=case p_queue when 'kyc' then 'kyc' else 'business' end and c.subject_id<>actor
      and (c.claimed_by is null or c.claim_expires_at<=clock_timestamp())
      and ((c.kind='kyc' and s.id is not null) or (c.kind='business' and exists(select 1 from private.evidence_artifacts a where a.case_id=c.id and a.purpose='registration' and a.state='clean')))
      order by coalesce(s.risk_score,0) desc,coalesce(s.created_at,c.created_at),c.id limit p_limit*2
    loop
      if not pg_try_advisory_xact_lock(hashtextextended(r.subject_id::text,2408)) then continue;end if;
      begin answer:=internal.claim_evidence_case(r.id);
      exception when sqlstate 'PT409' or sqlstate '22023' then continue;end;
      items:=items||jsonb_build_array(answer);
      exit when jsonb_array_length(items)>=p_limit;
    end loop;
    perform internal.staff_actor('case:claim');
  end if;
  return jsonb_build_object('items',items,'lease_minutes',case when p_queue in('content','reports') then 15 else 30 end);
end$$;
revoke all on function internal.claim_frontend_staff_items(text,integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_frontend_staff_items(text,integer) to authenticated;
create function api.claim_frontend_staff_items(p_queue text,p_limit integer) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.claim_frontend_staff_items(p_queue,p_limit)$$;
revoke all on function api.claim_frontend_staff_items(text,integer) from public,anon,authenticated,service_role;
grant execute on function api.claim_frontend_staff_items(text,integer) to authenticated;

create table private.frontend_evidence_claim_events(
  id bigint generated always as identity primary key,
  case_id uuid not null references private.evidence_cases(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  from_staff uuid references auth.users(id) on delete set null,
  to_staff uuid references auth.users(id) on delete set null,
  event text not null check(event in('released_by_staff','reassigned')),
  claim_generation bigint not null check(claim_generation>0),
  reason text not null check(length(reason) between 5 and 500),
  created_at timestamptz not null default statement_timestamp()
);
create index frontend_evidence_claim_events_case_idx on private.frontend_evidence_claim_events(case_id,created_at desc);
alter table private.frontend_evidence_claim_events enable row level security;
revoke all on private.frontend_evidence_claim_events from public,anon,authenticated,service_role;
revoke all on sequence private.frontend_evidence_claim_events_id_seq from public,anon,authenticated,service_role;
-- Audit rows follow native case-history retention/holds. Staff account deletion
-- anonymizes references; no extra document, legal name or identity copy is kept.
create function internal.reassign_frontend_staff_claim(p_type text,p_id uuid,p_to uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:reassign');subject uuid;c private.evidence_cases;reason text;previous uuid;
begin
  if p_id is null then raise exception 'typed queue subject required' using errcode='22023';end if;
  if p_type in('report','listing','business','promotion','content_edit') then
    if p_type='report' then
      if not exists(select 1 from private.reports x where x.id=p_id) then raise exception 'report unavailable' using errcode='22023';end if;
    elsif not exists(select 1 from private.posts p where p.id=p_id and
      (p_type='content_edit' and p.edit_of is not null or p.edit_of is null and p.kind=case p_type when 'promotion' then 'event' else p_type end)) then
      raise exception 'post type changed' using errcode='22023';end if;
    return internal.reassign_queue_claim(case when p_type='report' then 'report' else 'post' end,p_id,p_to,p_reason);
  end if;
  if p_type is null or p_type not in('verification_step','business_verification') then raise exception 'typed evidence case required' using errcode='22023';end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb,to_jsonb(p_reason))#>>'{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid reason required' using errcode='22023';end if;
  if p_to is not null then perform pg_advisory_xact_lock(hashtextextended(p_to::text,1201));end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_id;
  if not found then raise exception 'case unavailable' using errcode='22023';end if;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_id for update;
  if not found then raise exception 'case unavailable' using errcode='22023';end if;
  actor:=internal.staff_actor('queue:reassign');
  if c.subject_id=actor or c.subject_id=p_to then raise exception 'self-review is not allowed' using errcode='42501';end if;
  if c.kind<>(case p_type when 'verification_step' then 'kyc' else 'business' end) then raise exception 'case type changed' using errcode='22023';end if;
  if c.status<>'open' or c.claimed_by is null or c.claim_expires_at<=clock_timestamp() then raise exception 'nobody holds this case' using errcode='PT409';end if;
  previous:=c.claimed_by;
  if p_to is null then
    update private.evidence_cases set claimed_by=null,claim_nonce=null,claim_expires_at=null where id=c.id;
  else
    if p_to=previous then raise exception 'reviewer already holds this case' using errcode='22023';end if;
    if not exists(select 1 from private.staff_roles r join private.staff_capabilities k on k.role=r.role
      join private.current_account_access a on a.id=r.user_id where r.user_id=p_to and r.revoked_at is null and k.capability='case:claim') then
      raise exception 'independent eligible reviewer required' using errcode='22023';end if;
    update private.evidence_cases set claimed_by=p_to,claim_generation=claim_generation+1,claim_nonce=gen_random_uuid(),claim_expires_at=clock_timestamp()+interval '30 minutes'
      where id=c.id and claim_generation<9223372036854775807 returning * into c;
    if not found then raise exception 'claim generation exhausted' using errcode='PT409';end if;
  end if;
  insert into private.frontend_evidence_claim_events(case_id,actor_id,from_staff,to_staff,event,claim_generation,reason)
    values(c.id,actor,previous,p_to,case when p_to is null then 'released_by_staff' else 'reassigned' end,c.claim_generation,reason);
  perform internal.staff_actor('queue:reassign');
  return jsonb_build_object('subject','case','id',c.id,'status',case when p_to is null then 'released' else 'reassigned' end,'claim_generation',c.claim_generation::text);
end$$;
revoke all on function internal.reassign_frontend_staff_claim(text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.reassign_frontend_staff_claim(text,uuid,uuid,text) to authenticated;
create function api.reassign_frontend_staff_claim(p_type text,p_id uuid,p_to uuid,p_reason text) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.reassign_frontend_staff_claim(p_type,p_id,p_to,p_reason)$$;
revoke all on function api.reassign_frontend_staff_claim(text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.reassign_frontend_staff_claim(text,uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
