-- Preserve the active content hold after the underlying report is retained
-- away. Keep only the facts needed for owner review and independent release.
begin;
alter table private.frontend_content_holds
  add column account_id uuid references auth.users(id) on delete cascade,
  add column actor_id uuid references auth.users(id) on delete set null,
  add column reporter_id uuid references auth.users(id) on delete set null,
  add column reason text check(length(reason) between 10 and 500),
  add column applied_at timestamptz;
update private.frontend_content_holds h
  set account_id=r.subject_account_id,actor_id=a.actor_id,reporter_id=r.reporter_id,reason=a.reason,applied_at=a.created_at
  from private.frontend_report_action_receipts a join private.reports r on r.id=a.report_id where a.id=h.id;
alter table private.frontend_content_holds
  alter column account_id set not null,alter column reason set not null,alter column applied_at set not null,
  drop constraint frontend_content_holds_id_fkey,
  alter column post_id drop not null,drop constraint frontend_content_holds_post_id_fkey,
  add foreign key(post_id) references private.posts(id) on delete set null;
create index frontend_content_holds_account_idx on private.frontend_content_holds(account_id,applied_at);
create index frontend_content_holds_actor_idx on private.frontend_content_holds(actor_id);
create index frontend_content_holds_reporter_idx on private.frontend_content_holds(reporter_id);
create index frontend_content_holds_post_reference_idx on private.frontend_content_holds(post_id) where post_id is not null;

do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer)'::regprocedure;
  if md5(body)<>'3dd78894d96fa820a5821783fd6ec371' then raise exception 'report action router drift';end if;
  changed:=replace(body,'insert into private.frontend_content_holds(id,post_id) values(receipt,post.id);',
    'insert into private.frontend_content_holds(id,post_id,account_id,actor_id,reporter_id,reason,applied_at)
      values(receipt,post.id,subject,actor,r.reporter_id,reason,clock_timestamp());');
  if changed=body then raise exception 'content hold history anchor missing';end if;
  execute format('create or replace function internal.execute_frontend_report_action_v2(p_report uuid,p_expected_revision integer,p_claim_generation text,p_claim_nonce uuid,p_action text,p_reason text,p_duration_days integer default null,p_emergency boolean default false,p_expected_post_revision integer default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);

  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.release_frontend_content_hold(uuid,integer,text)'::regprocedure;
  if md5(body)<>'c86d19842208b326d9192f73ab469db5' then raise exception 'content release drift';end if;
  changed:=replace(body,'x.post_id,p.owner_id into target,subject from private.frontend_content_holds x join private.posts p on p.id=x.post_id',
    'x.post_id,x.account_id into target,subject from private.frontend_content_holds x');
  changed:=replace(changed,'actor=receipt.actor_id or actor=r.reporter_id','actor=h.actor_id or actor=h.reporter_id');
  changed:=replace(changed,'  receipt private.frontend_report_action_receipts;r private.reports;post private.posts;',
    '  post private.posts;');
  changed:=replace(changed,'  select * into receipt from private.frontend_report_action_receipts where id=h.id;
  select * into r from private.reports where id=receipt.report_id;','');
  changed:=replace(replace(replace(replace(changed,';reason text;',';review_reason text;'),
    '  reason:=','  review_reason:='),'h.release_reason=reason','h.release_reason=review_reason'),'release_reason=reason where','release_reason=review_reason where');
  if changed=body or position('receipt.report_id' in changed)>0 then raise exception 'content release history anchor missing';end if;
  execute format('create or replace function internal.release_frontend_content_hold(p_hold uuid,p_expected_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;

-- Older canonical native decisions are still appealable. Bind them to the
-- same effect model, without inventing a report or exposing an identity fact.
insert into private.frontend_account_restrictions(decision_id,account_id,kind,reason,emergency,starts_at)
  select d.id,c.subject_id,'ban','Account restricted after an independent review.',false,d.approved_at
  from private.decisions d join private.evidence_cases c on c.id=d.case_id
  where d.scope_kind='native' and d.status='approved' and d.action='restrict_account'
  on conflict(decision_id,emergency) do nothing;
create function internal.bind_native_restriction_for_review()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  insert into private.frontend_account_restrictions(decision_id,account_id,kind,reason,emergency,starts_at)
    select new.id,c.subject_id,'ban','Account restricted after an independent review.',false,new.approved_at
    from private.evidence_cases c where c.id=new.case_id;
  return new;
end$$;
revoke all on function internal.bind_native_restriction_for_review() from public,anon,authenticated,service_role;
create trigger bind_native_restriction_for_review after update of status on private.decisions for each row
  when(old.status='proposed' and new.status='approved' and new.scope_kind='native' and new.action='restrict_account')
  execute function internal.bind_native_restriction_for_review();
do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.record_identity_ban(uuid,text,text)'::regprocedure;
  if md5(body)<>'c2a11df449fe65ba8d498d5252dc54bc' then raise exception 'identity ban replay guard drift';end if;
  changed:=replace(body,'if decision.scope_kind=''report_ban'' and exists','if exists');
  if changed=body then raise exception 'identity ban lift scope anchor missing';end if;
  execute format('create or replace function internal.record_identity_ban(p_decision_id uuid,p_identity_hmac text,p_category text) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.get_frontend_enforcement()'::regprocedure;
  if md5(body)<>'94300aeb33ca84b4e442d399db1c490f' then raise exception 'enforcement view drift';end if;
  changed:=replace(body,'d.scope_kind=''native'' and d.status=''approved''',
    'd.scope_kind=''native'' and d.status=''approved'' and not exists(select 1 from private.frontend_account_restrictions y where y.decision_id=d.id and not y.emergency)');
  if changed=body then raise exception 'native enforcement exclusion anchor missing';end if;
  execute format('create or replace function internal.get_frontend_enforcement() returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.get_my_frontend_restriction_status()'::regprocedure;
  if md5(body)<>'11898622edf3fbe842c14b225643ad4c' then raise exception 'self restriction status drift';end if;
  changed:=replace(body,'and d.scope_kind=''native'')','and d.scope_kind=''native'' and not exists(select 1 from private.frontend_account_restrictions y where y.decision_id=d.id and not y.emergency))');
  if changed=body then raise exception 'native restriction status exclusion anchor missing';end if;
  execute format('create or replace function internal.get_my_frontend_restriction_status() returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;

-- For suspensions, the final restriction records an approved shortening;
-- the immutable proposal is the upper bound and fallback if no row exists.
do $$begin
  if md5(replace(pg_get_viewdef('private.current_account_access'::regclass,true),E'\r\n',E'\n'))<>'99de6f40bce2caa683e41b57cc73d935'
    then raise exception 'account restriction view drift';end if;
end$$;
create or replace view private.current_account_access with(security_invoker=true) as
  select u.id from auth.users u where u.is_anonymous is false and u.deleted_at is null and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until<=statement_timestamp())
    and not exists(select 1 from private.account_closures c where c.user_id=u.id)
    and not exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
      left join private.frontend_account_restrictions x on x.decision_id=d.id and not x.emergency
      where c.subject_id=u.id and d.status='approved' and d.action='restrict_account'
      and x.lifted_at is null and
        (d.scope_kind in('native','report_ban') or
          least(d.approved_at+make_interval(days=>d.suspension_days),x.ends_at)>statement_timestamp()))
    and not exists(select 1 from private.frontend_account_restrictions x where x.account_id=u.id and x.emergency and x.lifted_at is null and x.ends_at>statement_timestamp());
revoke all on private.current_account_access from public,anon,authenticated,service_role;

insert into private.staff_capabilities(role,capability,requires_recent_mfa) values
  ('admin','appeal:decide',true),('governor','appeal:decide',true);
create table private.frontend_appeals(
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique,
  appellant_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in('suspension','ban','warning','content_hidden')),
  reason text not null check(length(reason) between 20 and 2000),
  status text not null default 'submitted' check(status in('submitted','upheld','overturned','partially_overturned','dismissed')),
  created_at timestamptz not null default clock_timestamp(),
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewer_rationale text check(length(reviewer_rationale) between 10 and 2000),
  resolved_at timestamptz,
  shorten_to timestamptz,
  resolution_effect_version integer check(resolution_effect_version>0),
  effects_changed integer not null default 0 check(effects_changed between 0 and 1),
  check((status='submitted')=(resolved_at is null)),
  check((resolved_at is null)=(reviewer_rationale is null)),
  check((status='partially_overturned')=(shorten_to is not null))
);
create index frontend_appeals_appellant_idx on private.frontend_appeals(appellant_id,created_at);
create index frontend_appeals_reviewer_idx on private.frontend_appeals(reviewer_id);
create index frontend_appeals_pending_idx on private.frontend_appeals(created_at,id) where status='submitted';
alter table private.frontend_appeals enable row level security;
revoke all on private.frontend_appeals from public,anon,authenticated,service_role;

create view private.frontend_appealable_actions with(security_invoker=true) as
  select x.decision_id id,x.account_id,x.kind,x.reason,x.starts_at,x.ends_at,
    x.lifted_at is null and (x.ends_at is null or x.ends_at>statement_timestamp()) active,
    not x.emergency appealable,d.proposed_by actor_id,d.approved_by approver_id,x.reporter_id,x.id effect_id,x.version effect_version
  from private.frontend_account_restrictions x join private.decisions d on d.id=x.decision_id
  where not x.emergency or not exists(select 1 from private.frontend_account_restrictions y where y.decision_id=x.decision_id and not y.emergency)
  union all
  select h.id,h.account_id,'content_hidden',h.reason,h.applied_at,null,h.released_at is null and h.post_id is not null,true,h.actor_id,null,h.reporter_id,h.id,h.version
    from private.frontend_content_holds h
  union all
  select w.receipt_id,w.account_id,'warning',a.reason,a.created_at,null,false,true,a.actor_id,null,r.reporter_id,null,null
    from private.frontend_account_warnings w join private.frontend_report_action_receipts a on a.id=w.receipt_id join private.reports r on r.id=a.report_id;
revoke all on private.frontend_appealable_actions from public,anon,authenticated,service_role;

create function internal.get_my_frontend_decisions()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.frontend_self_review_actor();result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('decisionId',x.id,'kind',x.kind,'reason',x.reason,'startsAt',x.starts_at,'endsAt',x.ends_at,'active',x.active,
    'appealable',x.appealable and a.id is null,'appeal',case when a.id is not null then
      jsonb_build_object('id',a.id,'status',a.status,'outcome',a.reviewer_rationale,'resolvedAt',a.resolved_at) end)
    order by x.starts_at desc,x.id desc),'[]'::jsonb) into result
    from (select * from private.frontend_appealable_actions where account_id=actor order by starts_at desc,id desc limit 100)x
    left join private.frontend_appeals a on a.action_id=x.id and a.appellant_id=actor;
  perform internal.frontend_self_review_actor();return jsonb_build_object('account_id',actor,'items',result);
end$$;

create function internal.submit_my_frontend_appeal(p_action uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.frontend_self_review_actor();explanation text;x private.frontend_appealable_actions;a private.frontend_appeals;
begin
  explanation:=internal.validate_attribute_value('{"type":"string","minLength":20,"maxLength":2000}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if explanation is null or explanation ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'appeal reason required' using errcode='22023';end if;
  perform internal.lock_verification_subject(actor);
  perform internal.frontend_self_review_actor();
  select * into x from private.frontend_appealable_actions where id=p_action and account_id=actor;
  if not found or not x.appealable then raise exception 'decision cannot be appealed' using errcode='PT409';end if;
  select * into a from private.frontend_appeals where action_id=p_action;
  if found then
    if a.appellant_id=actor and a.reason=explanation and a.status='submitted'
      then return jsonb_build_object('appeal_id',a.id,'status','submitted','reused',true);end if;
    raise exception 'decision already appealed' using errcode='PT409';
  end if;
  insert into private.frontend_appeals(action_id,appellant_id,kind,reason) values(p_action,actor,x.kind,explanation) returning * into a;
  return jsonb_build_object('appeal_id',a.id,'status','submitted');
end$$;

create function internal.get_frontend_appeal_queue(p_appeal uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('appeal:decide');items jsonb;total bigint;
begin
  with eligible as (
    select * from private.frontend_appeals a where (p_appeal is null and a.status='submitted') or a.id=p_appeal
  )
  select (select count(*) from eligible),coalesce(jsonb_agg(jsonb_build_object('id',a.id,'decision_id',a.action_id,'appellant_id',a.appellant_id,
    'reason',a.reason,'kind',a.kind,'status',a.status,'created_at',a.created_at,'reviewer_id',a.reviewer_id,
    'reviewer_rationale',a.reviewer_rationale,'resolved_at',a.resolved_at,'effect_version',x.effect_version,'ends_at',x.ends_at,
    'decision_reason',x.reason,
    'can_resolve',a.status='submitted' and x.id is not null and not coalesce(actor in(a.appellant_id,x.actor_id,x.approver_id,x.reporter_id),false))
    order by a.created_at,a.id),'[]'::jsonb) into total,items
    from (select * from eligible order by created_at,id limit 50)a
    left join private.frontend_appealable_actions x on x.id=a.action_id and x.account_id=a.appellant_id;
  perform internal.staff_actor('appeal:decide');return jsonb_build_object('actor_id',actor,'items',items,'total',total);
end$$;

create function internal.resolve_frontend_appeal(p_appeal uuid,p_outcome text,p_reason text,p_effect_version integer default null,p_shorten_to timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('appeal:decide');review_reason text;subject uuid;a private.frontend_appeals;
  x private.frontend_appealable_actions;changed integer:=0;now_at timestamptz;
begin
  if p_outcome is null or p_outcome not in('upheld','overturned','partially_overturned','dismissed')
    or ((p_outcome='partially_overturned')<>(p_shorten_to is not null)) then raise exception 'valid appeal outcome required' using errcode='22023';end if;
  review_reason:=internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":2000}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if review_reason is null or review_reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'appeal outcome reason required' using errcode='22023';end if;
  select appellant_id into subject from private.frontend_appeals where id=p_appeal;
  if not found then raise exception 'appeal unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into a from private.frontend_appeals where id=p_appeal for update;
  select * into x from private.frontend_appealable_actions where id=a.action_id and account_id=subject;
  actor:=internal.staff_actor('appeal:decide');
  if not found or x.id is null or a.kind<>x.kind then raise exception 'appealed decision changed' using errcode='PT409';end if;
  if actor in(subject,x.actor_id,x.approver_id,x.reporter_id) then raise exception 'independent appeal reviewer required' using errcode='42501';end if;
  if a.status<>'submitted' then
    if a.reviewer_id=actor and a.status=p_outcome and a.reviewer_rationale=review_reason and a.shorten_to is not distinct from p_shorten_to
      and a.resolution_effect_version is not distinct from p_effect_version
      then return jsonb_build_object('appeal_id',a.id,'status',a.status,'restrictions_changed',a.effects_changed,'reused',true);end if;
    raise exception 'appeal already resolved' using errcode='PT409';
  end if;
  if x.effect_version is distinct from p_effect_version then raise exception 'appeal effect changed' using errcode='PT409';end if;
  now_at:=clock_timestamp();
  if p_outcome='partially_overturned' then
    if x.kind<>'suspension' or not x.active or p_shorten_to>=x.ends_at or x.effect_version>=2147483647
      then raise exception 'a shorter active suspension is required' using errcode='PT409';end if;
    if p_shorten_to<=now_at then
      perform internal.lift_frontend_account_restriction(x.effect_id,x.effect_version,'Appeal reduced this suspension to time served.');
    else
      update private.frontend_account_restrictions set ends_at=p_shorten_to,version=version+1 where id=x.effect_id;
    end if;
    changed:=1;
  elsif p_outcome='overturned' and x.active then
    if x.kind='content_hidden' then
      perform internal.release_frontend_content_hold(x.effect_id,x.effect_version,'Independent appeal overturned the content hold.');
    elsif x.kind in('suspension','ban') then
      perform internal.lift_frontend_account_restriction(x.effect_id,x.effect_version,'Independent appeal overturned the restriction.');
      changed:=1;
    end if;
  end if;
  update private.frontend_appeals set status=p_outcome,reviewer_id=actor,reviewer_rationale=review_reason,
    resolved_at=now_at,shorten_to=p_shorten_to,effects_changed=changed,resolution_effect_version=p_effect_version where id=a.id;
  perform internal.staff_actor('appeal:decide');
  return jsonb_build_object('appeal_id',a.id,'status',p_outcome,'restrictions_changed',changed);
end$$;

create function api.get_my_frontend_decisions() returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_my_frontend_decisions()$$;
create function api.submit_my_frontend_appeal(p_action uuid,p_reason text) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.submit_my_frontend_appeal(p_action,p_reason)$$;
create function api.get_frontend_appeal_queue(p_appeal uuid default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_appeal_queue(p_appeal)$$;
create function api.resolve_frontend_appeal(p_appeal uuid,p_outcome text,p_reason text,p_effect_version integer default null,p_shorten_to timestamptz default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.resolve_frontend_appeal(p_appeal,p_outcome,p_reason,p_effect_version,p_shorten_to)$$;
do $$declare signature text;namespace text;begin
  foreach signature in array array['get_my_frontend_decisions()','submit_my_frontend_appeal(uuid,text)','get_frontend_appeal_queue(uuid)','resolve_frontend_appeal(uuid,text,text,integer,timestamptz)'] loop
    foreach namespace in array array['api','internal'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated,service_role',namespace,signature);
      execute format('grant execute on function %I.%s to authenticated',namespace,signature);
    end loop;
  end loop;
end$$;

-- Publish generic owner notices only after an actual moderation effect or
-- appeal resolution. The email never includes the reporter or appeal text.
alter table private.notifications drop constraint notifications_kind_check;
alter table private.notifications add constraint notifications_kind_check check(kind in('enquiry_received',
  'organisation_application_received','organisation_application_decided','organisation_affiliation_ended',
  'organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided'));
alter table private.outbox_events drop constraint outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check(kind in('payment_completed','payment_reversed',
  'payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted',
  'verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided'));

create function internal.publish_frontend_moderation_notice()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare owner_id uuid;notice text;
begin
  case tg_table_name
    when 'frontend_content_holds' then owner_id:=new.account_id;notice:='content_hidden';
    when 'frontend_account_restrictions' then owner_id:=new.account_id;notice:=case new.kind when 'ban' then 'account_banned' else 'account_suspended' end;
    when 'frontend_appeals' then owner_id:=new.appellant_id;notice:='appeal_decided';
    else raise exception 'unknown moderation notice source';
  end case;
  insert into private.notifications(account_id,kind,subject_id) values(owner_id,notice,new.id);
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values(notice,new.id,owner_id,notice||':'||new.id)
    on conflict(dedupe_key) do nothing;
  return new;
end$$;
revoke all on function internal.publish_frontend_moderation_notice() from public,anon,authenticated,service_role;
create trigger publish_frontend_hidden_notice after insert on private.frontend_content_holds
  for each row execute function internal.publish_frontend_moderation_notice();
create trigger publish_frontend_restriction_notice after insert on private.frontend_account_restrictions
  for each row execute function internal.publish_frontend_moderation_notice();
create trigger publish_frontend_appeal_notice after update of status on private.frontend_appeals
  for each row when(old.status='submitted' and new.status<>'submitted') execute function internal.publish_frontend_moderation_notice();

do $$declare body text;begin
  body:=replace(pg_get_viewdef('private.frontend_staff_audit_events'::regclass,true),E'\r\n',E'\n');
  if md5(body)<>'dd6aa93d476ef39228fb24a58467f719' then raise exception 'staff audit view drift';end if;
  execute 'create or replace view private.frontend_staff_audit_events with(security_invoker=true) as '||rtrim(body,E';\n ')||$events$
    union all select 'appeal_submit:'||a.id,a.created_at,a.appellant_id,a.appellant_id,'account','appeal:submitted',null
      from private.frontend_appeals a
    union all select 'appeal_review:'||a.id,a.resolved_at,a.reviewer_id,a.appellant_id,'account','appeal:'||a.status,a.reviewer_rationale
      from private.frontend_appeals a where a.resolved_at is not null
    union all select 'restriction_lift:'||x.id,x.lifted_at,x.lifted_by,x.account_id,'account','restriction:lifted',x.lift_reason
      from private.frontend_account_restrictions x where x.lifted_at is not null
  $events$;
end$$;
revoke all on private.frontend_staff_audit_events from public,anon,authenticated,service_role;

do $$declare body text;changed text;
  extras text:='''account_warning'',''content_hidden'',''account_suspended'',''account_banned'',''appeal_decided''';
begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.claim_supported_notification_outbox(text[],integer)'::regprocedure;
  if md5(body)<>'7f82277ff66f03edd54860b546e3c6d6' then raise exception 'supported outbox drift';end if;
  changed:=replace(replace(replace(body,'between 1 and 12','between 1 and 16'),'''account_warning'')) then raise exception',''||extras||')) then raise exception'),
    'o.kind<>''account_warning'' or','o.kind not in('||extras||') or');
  if changed=body or position('''appeal_decided'')) then raise exception' in changed)=0 then raise exception 'supported appeal mail anchor missing';end if;
  execute format('create or replace function internal.claim_supported_notification_outbox(p_supported_kinds text[],p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.list_my_frontend_notifications(integer,boolean,timestamptz)'::regprocedure;
  if md5(body)<>'a61d0615f97b344d578e8fca4f632069' then raise exception 'older frontend notifications drift';end if;
  changed:=replace(body,'n.kind<>''account_warning''','n.kind not in('||extras||')');
  if changed=body then raise exception 'older notification filter anchor missing';end if;
  execute format('create or replace function internal.list_my_frontend_notifications(p_limit integer,p_unread boolean,p_before timestamptz) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.list_my_notifications(timestamptz,uuid,integer)'::regprocedure;
  if md5(body)<>'4a35850f0e8b362a3934cdcbc60972fe' then raise exception 'older native notifications drift';end if;
  changed:=replace(replace(body,'n.kind<>''account_warning''','n.kind not in('||extras||')'),'y.kind<>''account_warning''','y.kind not in('||extras||')');
  if changed=body then raise exception 'older native notification filter anchor missing';end if;
  execute format('create or replace function internal.list_my_notifications(p_before_created timestamptz,p_before_id uuid,p_limit integer) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.list_my_frontend_notices(integer,boolean,timestamptz)'::regprocedure;
  if md5(body)<>'de972e3895ac2b491f572584aa7ffe85' then raise exception 'current notices drift';end if;
  changed:=replace(body,'n.account_id=actor','n.account_id=actor and (n.kind<>''account_warning'' or exists(
    select 1 from private.frontend_account_warnings w where w.account_id=actor and w.receipt_id=n.subject_id))');
  if changed=body then raise exception 'warning retention notice anchor missing';end if;
  execute format('create or replace function internal.list_my_frontend_notices(p_limit integer,p_unread boolean,p_before timestamptz) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',changed);
end$$;
notify pgrst,'reload schema';
commit;
