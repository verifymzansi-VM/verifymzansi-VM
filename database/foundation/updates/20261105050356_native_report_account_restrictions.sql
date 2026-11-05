-- Report restrictions use the native independent decision ledger. A timed
-- suspension and provisional containment are never an indefinite native ban.
begin;
insert into private.staff_capabilities(role,capability,requires_recent_mfa) values
  ('admin','account:contain',true),('governor','account:contain',true),
  ('admin','account:restore',true),('governor','account:restore',true);
alter table private.decisions add column scope_kind text not null default 'native' check(scope_kind in('native','report_suspension','report_ban')),
  add column suspension_days integer check(suspension_days between 1 and 30),
  add check((scope_kind='report_suspension')=(suspension_days is not null)),
  add check(scope_kind='native' or action='restrict_account');
alter table private.reports add column active_proposal_id uuid references private.decisions(id) on delete set null;
create index reports_active_proposal_idx on private.reports(active_proposal_id) where active_proposal_id is not null;
create table private.frontend_report_proposals(
  decision_id uuid primary key references private.decisions(id) on delete cascade,
  receipt_id uuid not null unique references private.frontend_report_action_receipts(id) on delete cascade,
  report_revision integer not null check(report_revision>0),
  expires_at timestamptz not null
);
create table private.frontend_account_restrictions(
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references private.decisions(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  kind text not null check(kind in('suspension','ban')),
  reason text not null check(length(reason) between 10 and 500),
  emergency boolean not null,starts_at timestamptz not null,ends_at timestamptz,
  version integer not null default 1 check(version>0),
  lifted_at timestamptz,lifted_by uuid references auth.users(id) on delete set null,
  lift_reason text check(lift_reason is null or length(lift_reason) between 5 and 500),
  unique(decision_id,emergency),
  check((kind='ban')=(ends_at is null)),check(ends_at is null or ends_at>starts_at),
  check(not emergency or kind='suspension'),check((lifted_at is null)=(lift_reason is null))
);
create index frontend_account_restrictions_subject_idx on private.frontend_account_restrictions(account_id,ends_at) where lifted_at is null;
create index frontend_account_restrictions_reporter_idx on private.frontend_account_restrictions(reporter_id);
create index frontend_account_restrictions_releaser_idx on private.frontend_account_restrictions(lifted_by);
alter table private.frontend_report_proposals enable row level security;
alter table private.frontend_account_restrictions enable row level security;
revoke all on private.frontend_report_proposals,private.frontend_account_restrictions from public,anon,authenticated,service_role;

do $$declare body text;begin
  if md5(replace(pg_get_viewdef('private.current_account_access'::regclass,true),E'\r\n',E'\n'))<>'535ab721b93536b5220289d84bf795eb' then raise exception 'account access guard drift';end if;
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.decision_binding_guard()'::regprocedure;
  if md5(body)<>'66e58f8a6954473f4d19fbdc9f3b4beb' then raise exception 'decision binding guard drift';end if;
  body:=replace(replace(body,'new.proposed_at)','new.proposed_at,new.scope_kind,new.suspension_days)'),
    'old.proposed_at)','old.proposed_at,old.scope_kind,old.suspension_days)');
  execute format('create or replace function internal.decision_binding_guard() returns trigger language plpgsql security invoker set search_path=pg_catalog as %L',body);
end$$;
create or replace view private.current_account_access with(security_invoker=true) as
  select u.id from auth.users u where u.is_anonymous is false and u.deleted_at is null and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until<=statement_timestamp())
    and not exists(select 1 from private.account_closures c where c.user_id=u.id)
    and not exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
      where c.subject_id=u.id and d.status='approved' and d.action='restrict_account'
      and (d.scope_kind='native' or ((d.scope_kind='report_ban' or d.approved_at+make_interval(days=>d.suspension_days)>statement_timestamp())
        and not exists(select 1 from private.frontend_account_restrictions x where x.decision_id=d.id and not x.emergency and x.lifted_at is not null))))
    and not exists(select 1 from private.frontend_account_restrictions x where x.account_id=u.id and x.emergency and x.lifted_at is null and x.ends_at>statement_timestamp());
revoke all on private.current_account_access from public,anon,authenticated,service_role;

create function internal.current_report_proposal(p_decision uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select exists(select 1 from private.frontend_report_proposals p join private.decisions d on d.id=p.decision_id
    where p.decision_id=p_decision and d.status='proposed' and p.expires_at>statement_timestamp());
$$;
revoke all on function internal.current_report_proposal(uuid) from public,anon,authenticated,service_role;

do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.lock_queue_subject(text,uuid)'::regprocedure;
  if md5(body)<>'e0ca8a45157f2118c0d0a4c4b3fc10a8' then raise exception 'report claim subject drift';end if;
  changed:=replace(body,'r.id = p_id and r.status = ''open'' for update','r.id = p_id and r.status = ''open'' and not internal.current_report_proposal(r.active_proposal_id) for update');
  if changed=body then raise exception 'report claim subject anchor missing';end if;
  execute format('create or replace function internal.lock_queue_subject(p_subject text,p_id uuid,out post_id uuid,out report_id uuid) language plpgsql security invoker set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.claim_queue_items(text,integer)'::regprocedure;
  if md5(body)<>'7a064e2c64066df2420cae1c2edbd934' then raise exception 'report claim batch drift';end if;
  changed:=replace(body,'where x.status = ''open'' and not internal.queue_conflict(actor,null,x.id)','where x.status = ''open'' and not internal.current_report_proposal(x.active_proposal_id) and not internal.queue_conflict(actor,null,x.id)');
  if changed=body then raise exception 'report claim batch anchor missing';end if;
  execute format('create or replace function internal.claim_queue_items(p_queue text,p_limit integer) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;

create function internal.propose_frontend_report_restriction(p_report uuid,p_expected_revision integer,p_generation text,p_nonce uuid,p_action text,p_reason text,p_days integer,p_emergency boolean)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('report:resolve');subject uuid;reason text;r private.reports;q private.queue_claims;
  prior private.frontend_report_action_receipts;proposal private.frontend_report_proposals;case_row private.evidence_cases;
  fact uuid;payload jsonb:='{}';decision uuid;receipt uuid:=gen_random_uuid();started timestamptz;deadline timestamptz;result_status text;
begin
  if p_action is null or p_action not in('suspend','ban') or p_emergency is null or p_expected_revision is null or p_expected_revision<1
    or p_action='suspend' and (p_days is null or p_days not between 1 and 30) or p_action='ban' and p_days is not null then raise exception 'valid represented restriction required' using errcode='22023';end if;
  if p_emergency then perform internal.staff_actor('account:contain');end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid restriction rationale required' using errcode='22023';end if;
  select subject_account_id into subject from private.reports where id=p_report;
  if not found then raise exception 'report unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into r from private.reports where id=p_report for update;
  actor:=internal.staff_actor('report:resolve');if p_emergency then perform internal.staff_actor('account:contain');end if;
  if r.subject_account_id is distinct from subject or internal.queue_conflict(actor,null,p_report) then raise exception 'independent report review required' using errcode='42501';end if;
  select * into prior from private.frontend_report_action_receipts x where x.report_id=p_report and x.expected_revision=p_expected_revision;
  if found then
    select * into proposal from private.frontend_report_proposals p where p.receipt_id=prior.id;
    if prior.actor_id=actor and prior.action=p_action and prior.reason=reason and prior.duration_days is not distinct from p_days and prior.emergency=p_emergency
      and prior.claim_generation::text=p_generation and prior.claim_nonce_digest=encode(sha256(convert_to(p_nonce::text,'UTF8')),'hex')
      and prior.acknowledged_until>clock_timestamp() and r.active_proposal_id=proposal.decision_id and internal.current_report_proposal(proposal.decision_id) then
      return jsonb_build_object('report_id',r.id,'action',p_action,'status',prior.status,'decision_id',proposal.decision_id,'reused',true);
    end if;
    raise exception 'restriction proposal changed' using errcode='PT409';
  end if;
  if r.status<>'open' or r.revision<>p_expected_revision or internal.current_report_proposal(r.active_proposal_id)
    or exists(select 1 from private.account_closures c where c.user_id=subject) or not exists(select 1 from auth.users u where u.id=subject and u.deleted_at is null) then raise exception 'report or subject changed' using errcode='PT409';end if;
  select * into q from private.queue_claims where report_id=r.id for update;
  perform internal.assert_queue_claim(q,actor,p_generation,p_nonce);
  if p_action='ban' then
    select f.id into fact from private.accepted_identity_facts f where f.owner_id=subject and f.revoked_at is null order by f.reviewed_at desc,f.id limit 1;
    if fact is not null then payload:=jsonb_build_object('identity_fact_id',fact,'identity_ban_category',case r.category when 'scam' then 'fraud' when 'impersonation' then 'impersonation' when 'harassment' then 'harassment' when 'misleading_info' then 'fake_listings' else 'other' end);end if;
  end if;
  started:=clock_timestamp();deadline:=started+case when p_emergency then interval '72 hours' else interval '7 days' end;
  insert into private.evidence_cases(subject_id,kind) values(subject,'restriction') returning * into case_row;
  insert into private.decisions(case_id,action,payload,case_version,reviewed_snapshot,proposed_by,proposed_at,scope_kind,suspension_days)
    values(case_row.id,'restrict_account',payload,case_row.version,internal.evidence_case_snapshot(case_row.id),actor,started,case p_action when 'ban' then 'report_ban' else 'report_suspension' end,p_days) returning id into decision;
  perform internal.consume_queue_claim('report',r.id,actor,p_generation,p_nonce);
  update private.reports set active_proposal_id=decision where id=r.id returning * into r;
  result_status:=case when p_emergency then 'emergency_applied' else 'proposed' end;
  insert into private.frontend_report_action_receipts(id,report_id,expected_revision,claim_generation,claim_nonce_digest,actor_id,action,reason,duration_days,emergency,status,acknowledged_until)
    values(receipt,r.id,p_expected_revision,q.claim_generation,encode(sha256(convert_to(q.claim_nonce::text,'UTF8')),'hex'),actor,p_action,reason,p_days,p_emergency,result_status,q.claim_expires_at);
  insert into private.frontend_report_proposals(decision_id,receipt_id,report_revision,expires_at) values(decision,receipt,r.revision,deadline);
  if p_emergency then insert into private.frontend_account_restrictions(decision_id,account_id,reporter_id,kind,reason,emergency,starts_at,ends_at)
    values(decision,subject,r.reporter_id,'suspension',reason,true,started,deadline);end if;
  perform internal.staff_actor('report:resolve');if p_emergency then perform internal.staff_actor('account:contain');end if;
  return jsonb_build_object('report_id',r.id,'action',p_action,'status',result_status,'decision_id',decision);
end$$;
revoke all on function internal.propose_frontend_report_restriction(uuid,integer,text,uuid,text,text,integer,boolean) from public,anon,authenticated,service_role;

create function internal.frontend_report_restriction_effect()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare proposal private.frontend_report_proposals;receipt private.frontend_report_action_receipts;r private.reports;subject uuid;actor uuid;finish timestamptz;
begin
  if new.scope_kind='native' or new.status not in('approved','withdrawn') then return new;end if;
  select * into proposal from private.frontend_report_proposals where decision_id=new.id;
  select * into receipt from private.frontend_report_action_receipts where id=proposal.receipt_id;
  select * into r from private.reports where id=receipt.report_id for update;
  select c.subject_id into subject from private.evidence_cases c where c.id=new.case_id;
  if proposal.decision_id is null or r.subject_account_id is distinct from subject or receipt.actor_id is distinct from new.proposed_by then raise exception 'bound report proposal required' using errcode='PT409';end if;
  if new.status='withdrawn' then
    actor:=auth.uid();
    if actor is distinct from new.withdrawn_by or actor=subject or actor=r.reporter_id then raise exception 'independent report refusal required' using errcode='42501';end if;
    update private.frontend_account_restrictions set lifted_at=clock_timestamp(),lifted_by=actor,lift_reason='Emergency review withdrawn or rejected',version=version+1
      where decision_id=new.id and emergency and lifted_at is null;
    update private.reports set active_proposal_id=null where id=r.id and active_proposal_id=new.id;
    return new;
  end if;
  actor:=internal.staff_actor('decision:approve');
  if actor is distinct from new.approved_by or actor in(subject,new.proposed_by) or actor=r.reporter_id then raise exception 'independent restriction approval required' using errcode='42501';end if;
  if proposal.expires_at<=clock_timestamp() or r.status<>'open' or r.revision<>proposal.report_revision or r.active_proposal_id is distinct from new.id
    or not exists(select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='report:resolve' where s.user_id=new.proposed_by and s.revoked_at is null)
    or not exists(select 1 from private.current_account_access a where a.id=new.proposed_by)
    or exists(select 1 from private.account_closures c where c.user_id=subject) then raise exception 'report proposal expired or changed' using errcode='PT409';end if;
  if new.payload ? 'identity_fact_id' and not exists(select 1 from private.accepted_identity_facts f where f.id::text=new.payload->>'identity_fact_id' and f.owner_id=subject and f.revoked_at is null) then raise exception 'represented identity fact changed' using errcode='PT409';end if;
  finish:=case when new.scope_kind='report_suspension' then new.approved_at+make_interval(days=>new.suspension_days) end;
  insert into private.frontend_account_restrictions(decision_id,account_id,reporter_id,kind,reason,emergency,starts_at,ends_at)
    values(new.id,subject,r.reporter_id,case new.scope_kind when 'report_ban' then 'ban' else 'suspension' end,receipt.reason,false,new.approved_at,finish);
  update private.frontend_account_restrictions set lifted_at=clock_timestamp(),lifted_by=actor,lift_reason='Replaced by the independently approved decision',version=version+1
    where decision_id=new.id and emergency and lifted_at is null;
  update private.reports set status='resolved',resolution_note=receipt.reason,resolved_by=actor,resolved_at=clock_timestamp(),active_proposal_id=null where id=r.id;
  perform internal.staff_actor('decision:approve');return new;
end$$;
revoke all on function internal.frontend_report_restriction_effect() from public,anon,authenticated,service_role;
create trigger frontend_report_restriction_effect after update of status on private.decisions for each row when(old.status='proposed' and new.status in('approved','withdrawn')) execute function internal.frontend_report_restriction_effect();

do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer)'::regprocedure;
  if md5(body)<>'cb5e7a349f555efb8428bf84c089b8e4' then raise exception 'report action router drift';end if;
  changed:=replace(body,'  if p_action is distinct from ''hide'' then',
    '  if p_action in(''suspend'',''ban'') then return internal.propose_frontend_report_restriction(p_report,p_expected_revision,p_claim_generation,p_claim_nonce,p_action,p_reason,p_duration_days,p_emergency);end if;
  if p_action is distinct from ''hide'' then');
  if changed=body then raise exception 'report action anchor missing';end if;
  execute format('create or replace function internal.execute_frontend_report_action_v2(p_report uuid,p_expected_revision integer,p_claim_generation text,p_claim_nonce uuid,p_action text,p_reason text,p_duration_days integer default null,p_emergency boolean default false,p_expected_post_revision integer default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;
do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.staff_decision_page(jsonb)'::regprocedure;
  if md5(body)<>'406e08ad7dbc79f8ef738a8ea9bcf4f2' then raise exception 'decision queue drift';end if;
  changed:=replace(body,'where (status_filter=''all'' or d.status=status_filter)',
    'where (status_filter=''all'' or d.status=status_filter) and not(status_filter=''proposed'' and d.scope_kind<>''native'' and not internal.current_report_proposal(d.id))');
  if changed=body then raise exception 'current proposal filter anchor missing';end if;
  execute format('create or replace function internal.staff_decision_page(p_request jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',changed);

  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.get_frontend_governance_page(jsonb)'::regprocedure;
  if md5(body)<>'0b8637809004b336ef2d749aa2dc0b27' then raise exception 'governance presentation drift';end if;
  changed:=replace(body,'''recommendation'',case when d.action=',
    '''report_id'',r.id,''display_category'',case when a.action=''ban'' then ''account_ban'' when a.action=''suspend'' then ''account_suspend'' end,
    ''proposal_expired'',coalesce(rp.expires_at<=clock_timestamp(),false),''reporter_conflict'',coalesce(r.reporter_id=actor,false),
    ''recommendation'',case when rp.decision_id is not null then (case a.action when ''ban'' then ''Ban this account.'' else ''Suspend this account for ''||a.duration_days||'' days.'' end)||'' Report: ''||r.id||''. Reason: ''||a.reason
    when d.action=');
  changed:=replace(changed,'into notes from private.decisions d where d.id in',
    'into notes from private.decisions d left join private.frontend_report_proposals rp on rp.decision_id=d.id left join private.frontend_report_action_receipts a on a.id=rp.receipt_id left join private.reports r on r.id=a.report_id where d.id in');
  if changed=body or position('proposal_expired' in changed)=0 then raise exception 'restriction presentation anchors missing';end if;
  execute format('create or replace function internal.get_frontend_governance_page(p_request jsonb default ''{}'') returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);

  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.get_frontend_report_review_queue(text)'::regprocedure;
  if md5(body)<>'b9bf83c7cdbfcb854e958368c78664eb' then raise exception 'report queue presentation drift';end if;
  changed:=replace(body,'case when x.value->''foundation''<>''null''::jsonb then',
    'case when internal.current_report_proposal(r.active_proposal_id) then jsonb_set(x.value,''{status}'',''"in_progress"''::jsonb)||jsonb_build_object(''awaiting_decision'',true) when x.value->''foundation''<>''null''::jsonb then');
  if changed=body then raise exception 'report awaiting-decision anchor missing';end if;
  execute format('create or replace function internal.get_frontend_report_review_queue(p_area text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;
-- Lifting one final ban must neither lift a separate ban nor permit a delayed
-- reconciliation to recreate the lifted identity marker.
do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.record_identity_ban(uuid,text,text)'::regprocedure;
  if md5(body)<>'e65ad44024a198b2b8363861b1ce6425' then raise exception 'identity ban writer drift';end if;
  changed:=replace(body,'  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_identity_hmac,2701));',
    '  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_identity_hmac,2701));
  if decision.scope_kind=''report_ban'' and exists(select 1 from private.frontend_account_restrictions x where x.decision_id=decision.id and not x.emergency and x.lifted_at is not null) then raise exception ''this report ban was lifted'' using errcode=''PT409'';end if;');
  if changed=body then raise exception 'identity ban lift fence anchor missing';end if;
  execute format('create or replace function internal.record_identity_ban(p_decision_id uuid,p_identity_hmac text,p_category text) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;
create function internal.lift_frontend_account_restriction(p_restriction uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('account:restore');subject uuid;review_reason text;
  x private.frontend_account_restrictions;d private.decisions;binding private.identity_ban_bindings;replacement private.identity_ban_bindings;
begin
  review_reason:=internal.retention_reason(p_reason);
  select account_id into subject from private.frontend_account_restrictions where id=p_restriction;
  if not found then raise exception 'restriction unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into x from private.frontend_account_restrictions where id=p_restriction for update;
  select * into d from private.decisions where id=x.decision_id;
  actor:=internal.staff_actor('account:restore');
  if actor in(subject,d.proposed_by,d.approved_by,x.reporter_id) then raise exception 'independent restriction lift required' using errcode='42501';end if;
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 then raise exception 'represented restriction version required' using errcode='22023';end if;
  if x.lifted_at is not null then
    if x.lifted_by=actor and x.lift_reason=review_reason and x.version=p_expected_version+1 then return jsonb_build_object('restriction_id',x.id,'status','lifted','reused',true);end if;
    raise exception 'restriction lift changed' using errcode='PT409';
  end if;
  if x.version<>p_expected_version or x.ends_at<=clock_timestamp() then raise exception 'restriction changed or expired' using errcode='PT409';end if;
  update private.frontend_account_restrictions set version=version+1,lifted_at=clock_timestamp(),lifted_by=actor,lift_reason=review_reason where id=x.id;
  if x.kind='ban' then
    select * into binding from private.identity_ban_bindings where decision_id=d.id;
    if found then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(binding.identity_hmac,2701));
      if exists(select 1 from private.banned_identities b where b.identity_hmac=binding.identity_hmac and b.decision_id=d.id) then
        select i.* into replacement from private.identity_ban_bindings i join private.decisions other on other.id=i.decision_id
          where i.identity_hmac=binding.identity_hmac and i.decision_id<>d.id and i.retain_until>clock_timestamp() and other.status='approved'
          and not exists(select 1 from private.frontend_account_restrictions r where r.decision_id=other.id and not r.emergency and r.lifted_at is not null)
          order by i.approved_at desc,i.decision_id desc limit 1;
        if found then
          update private.banned_identities b set decision_id=replacement.decision_id,category=replacement.category,banned_at=replacement.approved_at,retain_until=replacement.retain_until
            where b.identity_hmac=binding.identity_hmac and b.decision_id=d.id;
        else delete from private.banned_identities b where b.identity_hmac=binding.identity_hmac and b.decision_id=d.id;end if;
      end if;
    end if;
  end if;
  perform internal.staff_actor('account:restore');return jsonb_build_object('restriction_id',x.id,'status','lifted');
end$$;
revoke all on function internal.lift_frontend_account_restriction(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.lift_frontend_account_restriction(uuid,integer,text) to authenticated;
create function api.lift_frontend_account_restriction(p_restriction uuid,p_expected_version integer,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.lift_frontend_account_restriction(p_restriction,p_expected_version,p_reason)$$;
revoke all on function api.lift_frontend_account_restriction(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function api.lift_frontend_account_restriction(uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
