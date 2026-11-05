-- Warnings are informational account notices. They do not grant verification,
-- restrict access, or turn a proposal into an approved enforcement decision.
begin;
create table private.frontend_account_warnings(
  receipt_id uuid primary key references private.frontend_report_action_receipts(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade
);
create index frontend_account_warnings_account_idx on private.frontend_account_warnings(account_id);
alter table private.frontend_account_warnings enable row level security;
revoke all on private.frontend_account_warnings from public,anon,authenticated,service_role;
alter table private.notifications drop constraint notifications_kind_check;
alter table private.notifications add constraint notifications_kind_check check(kind in('enquiry_received',
  'organisation_application_received','organisation_application_decided','organisation_affiliation_ended',
  'organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','account_warning'));
alter table private.outbox_events drop constraint outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check(kind in('payment_completed','payment_reversed',
  'payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted',
  'verification_phone_confirmed','identity_accepted','enquiry_received','account_warning'));

-- Keep old app/worker consumers on their supported kind sets during rollout.
-- New consumers explicitly opt into supported kinds and warning details.
do $$declare body text;changed text;legacy text:='''payment_completed'',''payment_reversed'',''payment_reconciliation_required'',''trial_started'',''post_expired'',''post_expiry_reminder'',''draft_deletion_warning'',''post_deleted'',''verification_phone_confirmed'',''identity_accepted'',''enquiry_received''';begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.claim_notification_outbox(integer)'::regprocedure;
  if md5(body)<>'a9379fa06f76ce874e4241918e0ecc4c' then raise exception 'notification outbox drift';end if;
  changed:=replace(body,'where processed_at is null','where kind=any(p_supported_kinds) and processed_at is null');
  changed:=replace(changed,'  if p_limit is null',
    '  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 12 or coalesce(array_ndims(p_supported_kinds),0)<>1 then raise exception ''supported mail kinds required'' using errcode=''22023'';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('||legacy||',''account_warning'')) then raise exception ''unsupported mail kind'' using errcode=''22023'';end if;
  if p_limit is null');
  changed:=replace(changed,'''created_at'',o.created_at)',
    '''created_at'',o.created_at,''notice_reason'',case when o.kind=''account_warning'' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where r.id=o.subject_id and w.account_id=o.owner_id) end)');
  changed:=replace(changed,'and not u.is_anonymous then u.email end',
    'and not u.is_anonymous and (o.kind<>''account_warning'' or not exists(select 1 from private.account_closures c where c.user_id=u.id)) then u.email end');
  if changed=body or position('notice_reason' in changed)=0 or position('supported mail kinds required' in changed)=0 then raise exception 'supported outbox anchors missing';end if;
  execute format('create function internal.claim_supported_notification_outbox(p_supported_kinds text[],p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
  changed:=replace(body,'where processed_at is null','where kind in('||legacy||') and processed_at is null');
  if changed=body then raise exception 'legacy outbox anchor missing';end if;
  execute format('create or replace function internal.claim_notification_outbox(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;
create function api.claim_supported_notification_outbox(p_supported_kinds text[],p_limit integer default 20)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.claim_supported_notification_outbox(p_supported_kinds,p_limit)$$;
revoke all on function api.claim_supported_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
grant execute on function api.claim_supported_notification_outbox(text[],integer) to service_role;

do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.list_my_frontend_notifications(integer,boolean,timestamptz)'::regprocedure;
  if md5(body)<>'3a74313cec80a4df3a1ce706bc2f4841' then raise exception 'frontend notice projection drift';end if;
  changed:=replace(body,'''created_at'',n.created_at,',
    '''warning_reason'',case when n.kind=''account_warning'' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where w.account_id=actor and r.id=n.subject_id) end,''created_at'',n.created_at,');
  if changed=body then raise exception 'warning notice projection anchor missing';end if;
  execute format('create function internal.list_my_frontend_notices(p_limit integer,p_unread boolean,p_before timestamptz) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',changed);
  changed:=replace(body,'n.account_id=actor','n.account_id=actor and n.kind<>''account_warning''');
  execute format('create or replace function internal.list_my_frontend_notifications(p_limit integer,p_unread boolean,p_before timestamptz) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.list_my_notifications(timestamptz,uuid,integer)'::regprocedure;
  if md5(body)<>'9613960f10098552e851ac45fdec44a3' then raise exception 'native notice projection drift';end if;
  changed:=replace(replace(body,'n.account_id=actor','n.account_id=actor and n.kind<>''account_warning'''),'y.account_id=actor','y.account_id=actor and y.kind<>''account_warning''');
  execute format('create or replace function internal.list_my_notifications(p_before_created timestamptz,p_before_id uuid,p_limit integer) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',changed);
end$$;
revoke all on function internal.list_my_frontend_notices(integer,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function internal.list_my_frontend_notices(integer,boolean,timestamptz) to authenticated;
create function api.list_my_frontend_notices(p_limit integer default 25,p_unread boolean default false,p_before timestamptz default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$select internal.list_my_frontend_notices(p_limit,p_unread,p_before)$$;
revoke all on function api.list_my_frontend_notices(integer,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function api.list_my_frontend_notices(integer,boolean,timestamptz) to authenticated;

-- The command replacement below is bound to the reviewed dismissal revision.
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean)'::regprocedure)<>'ccaf62beca7cfd6c7de374bfd7f52277' then raise exception 'report command drift';end if;
end$$;

create or replace function internal.execute_frontend_report_action(p_report uuid,p_expected_revision integer,p_claim_generation text,p_claim_nonce uuid,p_action text,p_reason text,p_duration_days integer default null,p_emergency boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('report:resolve');r private.reports;q private.queue_claims;prior private.frontend_report_action_receipts;reason text;answer jsonb;receipt uuid:=gen_random_uuid();outcome text;final_status text;
begin
  if p_action is null or p_action not in('dismiss','warn','hide','suspend','ban') or p_expected_revision is null or p_expected_revision<1 or p_emergency is null then raise exception 'represented report action required' using errcode='22023';end if;
  -- Additional enforcement effects are integrated separately; an unimplemented
  -- action must never receive a successful native acknowledgement.
  if p_action not in('dismiss','warn') then raise exception 'native report enforcement integration is pending' using errcode='0A000';end if;
  if p_duration_days is not null or p_emergency then raise exception 'this action has no suspension parameters' using errcode='22023';end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid review reason required' using errcode='22023';end if;
  if p_action='warn' and length(reason)<10 then raise exception 'warning reason needs at least 10 characters' using errcode='22023';end if;
  outcome:=case p_action when 'dismiss' then 'dismissed' else 'resolved' end;
  final_status:=case p_action when 'dismiss' then 'dismissed' else 'applied' end;
  select * into r from private.reports where id=p_report for update;
  if not found then raise exception 'report unavailable' using errcode='PT409';end if;
  actor:=internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor,null,p_report) then raise exception 'self-review is not allowed' using errcode='42501';end if;
  select * into prior from private.frontend_report_action_receipts x where x.report_id=p_report and x.expected_revision=p_expected_revision;
  if found then
    if prior.actor_id=actor and prior.action=p_action and prior.reason=reason and prior.claim_generation::text=p_claim_generation
      and prior.claim_nonce_digest=encode(sha256(convert_to(p_claim_nonce::text,'UTF8')),'hex') and prior.acknowledged_until>clock_timestamp()
      and r.status=outcome and r.resolved_by=actor and r.resolution_note=reason
      and (p_action='dismiss' or exists(select 1 from private.frontend_account_warnings w where w.receipt_id=prior.id and w.account_id=r.subject_account_id)) then
      return jsonb_build_object('report_id',r.id,'action',p_action,'status',prior.status,'reused',true);
    end if;
    raise exception 'report action receipt changed' using errcode='PT409';
  end if;
  if r.revision<>p_expected_revision or r.status<>'open' then raise exception 'report changed since review' using errcode='PT409';end if;
  select * into q from private.queue_claims where report_id=r.id for update;
  perform internal.assert_queue_claim(q,actor,p_claim_generation,p_claim_nonce);
  if p_action='warn' and (exists(select 1 from private.account_closures c where c.user_id=r.subject_account_id) or not exists(select 1 from auth.users u where u.id=r.subject_account_id and u.deleted_at is null)) then raise exception 'report subject is closed' using errcode='PT409';end if;
  answer:=internal.resolve_report(r.id,p_claim_generation,p_claim_nonce,outcome,reason);
  if answer->>'id' is distinct from r.id::text or answer->>'status' is distinct from outcome then raise exception 'native report outcome could not be confirmed' using errcode='PT409';end if;
  insert into private.frontend_report_action_receipts(id,report_id,expected_revision,claim_generation,claim_nonce_digest,actor_id,action,reason,duration_days,emergency,status,acknowledged_until)
    values(receipt,r.id,p_expected_revision,q.claim_generation,encode(sha256(convert_to(q.claim_nonce::text,'UTF8')),'hex'),actor,p_action,reason,null,false,final_status,q.claim_expires_at);
  if p_action='warn' then
    insert into private.frontend_account_warnings(receipt_id,account_id) values(receipt,r.subject_account_id);
    insert into private.notifications(account_id,kind,subject_id) values(r.subject_account_id,'account_warning',receipt);
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values('account_warning',receipt,r.subject_account_id,'account_warning:'||receipt);
    perform internal.signal_owner_inbox(r.subject_account_id);
  end if;
  perform internal.staff_actor('report:resolve');
  return jsonb_build_object('report_id',r.id,'action',p_action,'status',final_status);
end$$;

do $$declare body text;begin
  body:=replace(pg_get_viewdef('private.frontend_staff_audit_events'::regclass,true),E'\r\n',E'\n');
  if md5(body)<>'df92d9d256fc89dcf57f543df3d2a197' then raise exception 'staff audit view drift';end if;
  execute 'create or replace view private.frontend_staff_audit_events with(security_invoker=true) as ('||rtrim(body,E';\n ')||') union all
    select ''report_action:''||r.id::text,r.created_at,r.actor_id,r.report_id,''report'',
      ''report:''||r.action||case r.status when ''proposed'' then ''_proposed'' when ''emergency_applied'' then ''_emergency'' else '''' end,r.reason
    from private.frontend_report_action_receipts r';
end$$;
revoke all on private.frontend_staff_audit_events from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
