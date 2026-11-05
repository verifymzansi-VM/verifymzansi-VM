-- Private data request intake and staff workflow for the selected forms.
-- Intake never exposes data or automatically fulfils a deletion.
begin;
insert into private.staff_capabilities(role,capability,requires_recent_mfa) values
  ('admin','dsar:manage',true),('governor','dsar:manage',true);
create table private.privacy_request_rules(
  request_type text primary key check(request_type in('access','correction','deletion','objection')),
  days integer not null check(days>0),
  extension_days integer not null check(extension_days between 0 and 30),
  statutory boolean not null,
  source text not null
);
insert into private.privacy_request_rules values
  ('access',30,30,true,'Access request: POPIA section 23 and PAIA sections 56–57; 30 days, with a single permitted extension and written notice.'),
  ('correction',30,0,false,'Internal response target for a correction request.'),
  ('deletion',30,0,false,'Internal response target for a deletion request.'),
  ('objection',30,0,false,'Internal response target for an objection request.');

create table private.privacy_requests(
  id uuid primary key default gen_random_uuid(),
  type text not null references private.privacy_request_rules(request_type),
  subject_user_id uuid references auth.users(id) on delete set null,
  requester_email text not null check(length(requester_email) between 3 and 254),
  requester_phone text not null default 'not_provided' check(length(requester_phone) between 1 and 30),
  description text not null check(length(description) between 2 and 3400),
  identity_check text not null check(identity_check in('session','manual')),
  identity_verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  intake_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  processed_by uuid references auth.users(id) on delete set null,
  status text not null default 'submitted' check(status in('submitted','identity_pending','in_progress','completed','rejected')),
  received_at timestamptz not null,
  due_by timestamptz not null check(due_by>received_at),
  legal_basis text not null,
  extended_due_at timestamptz check(extended_due_at>due_by),
  extension_reason text check(length(extension_reason) between 10 and 1000),
  extension_notified_at timestamptz,
  effective_due_at timestamptz generated always as(coalesce(extended_due_at,due_by)) stored,
  response_summary text check(length(response_summary) between 1 and 4200),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  revision integer not null default 1 check(revision>0),
  check(identity_verified=(verified_at is not null)),
  check((status='completed')=(completed_at is not null)),
  check((extended_due_at is null)=(extension_reason is null))
);
create index privacy_requests_subject_idx on private.privacy_requests(subject_user_id,created_at desc);
create index privacy_requests_open_idx on private.privacy_requests(effective_due_at,id) where status in('submitted','identity_pending','in_progress');
create index privacy_requests_closed_idx on private.privacy_requests(created_at desc,id) where status in('completed','rejected');
create index privacy_requests_assignee_idx on private.privacy_requests(assigned_to);
create index privacy_requests_intake_idx on private.privacy_requests(intake_by);
create index privacy_requests_verifier_idx on private.privacy_requests(verified_by);
create index privacy_requests_processor_idx on private.privacy_requests(processed_by);
create index privacy_requests_type_idx on private.privacy_requests(type);

create table private.privacy_request_events(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references private.privacy_requests(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in('submitted','recorded','assigned','unassigned','extended','identity_verified','started','rejected','completed','exported')),
  represented_revision integer not null check(represented_revision>0),
  occurred_at timestamptz not null default clock_timestamp()
);
create index privacy_events_request_idx on private.privacy_request_events(request_id,occurred_at);
create index privacy_events_actor_idx on private.privacy_request_events(actor_id);

-- The recipient, deadline and notice are committed with the case. Notices
-- about external/manual cases are likewise service-only and contain no data.
create table private.privacy_notice_jobs(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references private.privacy_requests(id) on delete cascade,
  kind text not null check(kind in('submitted','extended','rejected','completed')),
  created_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz,
  attempts integer not null default 0 check(attempts between 0 and 10),
  next_attempt_at timestamptz not null default clock_timestamp(),
  claim_token uuid,locked_until timestamptz,
  unique(request_id,kind),
  check((claim_token is null)=(locked_until is null))
);
create index privacy_notices_waiting_idx on private.privacy_notice_jobs(next_attempt_at,id) where delivered_at is null;
alter table private.privacy_request_rules enable row level security;
alter table private.privacy_requests enable row level security;
alter table private.privacy_request_events enable row level security;
alter table private.privacy_notice_jobs enable row level security;
revoke all on private.privacy_request_rules,private.privacy_requests,private.privacy_request_events,private.privacy_notice_jobs from public,anon,authenticated,service_role;

create function internal.privacy_text(p_value text,p_min integer,p_max integer)
returns text language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare clean text:=btrim(p_value);
begin
  if clean is null or length(clean) not between p_min and p_max
    or clean ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]'
    then raise exception 'check the request text' using errcode='22023';end if;
  return clean;
end$$;
revoke all on function internal.privacy_text(text,integer,integer) from public,anon,authenticated,service_role;

create function internal.record_frontend_privacy_request(p_account uuid,p_session uuid,p_type text,p_name text,p_last_four text,p_details text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare confirmed_email text;request_text text;rule private.privacy_request_rules;r private.privacy_requests;now_at timestamptz;
begin
  if p_last_four is not null and p_last_four !~ '^[0-9]{4}$' then raise exception 'masked identifier suffix required' using errcode='22023';end if;
  request_text:='Name: '||internal.privacy_text(p_name,2,120)
    ||case when p_last_four is not null then E'\nID ending: '||p_last_four else '' end
    ||case when p_details is not null then E'\n'||internal.privacy_text(p_details,1,2000) else '' end;
  select * into rule from private.privacy_request_rules where request_type=p_type;
  if not found then raise exception 'unknown privacy request type' using errcode='22023';end if;
  perform internal.lock_verification_subject(p_account);
  select u.email into confirmed_email from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=p_account and s.id=p_session and (s.not_after is null or s.not_after>clock_timestamp())
      and u.email_confirmed_at is not null and u.email is not null and not u.is_anonymous and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and not exists(select 1 from private.account_closures c where c.user_id=u.id);
  if not found then raise exception 'live confirmed account session required' using errcode='42501';end if;
  now_at:=clock_timestamp();
  select * into r from private.privacy_requests x where x.subject_user_id=p_account and x.type=p_type and x.identity_check='session'
    and x.description=request_text and x.requester_email=confirmed_email and x.created_at>now_at-interval '10 minutes' order by x.created_at desc limit 1;
  if found then return jsonb_build_object('id',r.id,'due_by',r.due_by,'reused',true);end if;
  if (select count(*) from private.privacy_requests x where x.subject_user_id=p_account and x.created_at>now_at-interval '1 hour')>=5
    then raise exception 'privacy request limit reached' using errcode='PT429';end if;
  insert into private.privacy_requests(type,subject_user_id,requester_email,description,identity_check,received_at,due_by,legal_basis)
    values(p_type,p_account,confirmed_email,request_text,'session',now_at,now_at+make_interval(days=>rule.days),rule.source) returning * into r;
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,p_account,'submitted',1);
  insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'submitted');
  return jsonb_build_object('id',r.id,'due_by',r.due_by);
end$$;
revoke all on function internal.record_frontend_privacy_request(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.record_frontend_privacy_request(uuid,uuid,text,text,text,text) to service_role;
create function api.record_frontend_privacy_request(p_account uuid,p_session uuid,p_type text,p_name text,p_last_four text,p_details text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.record_frontend_privacy_request(p_account,p_session,p_type,p_name,p_last_four,p_details)$$;
revoke all on function api.record_frontend_privacy_request(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function api.record_frontend_privacy_request(uuid,uuid,text,text,text,text) to service_role;

create function internal.record_frontend_privacy_intake(p_type text,p_email text,p_phone text,p_description text,p_note text,p_received timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('dsar:manage');rule private.privacy_request_rules;r private.privacy_requests;
  now_at timestamptz:=clock_timestamp();received timestamptz:=coalesce(p_received,now_at);email text:=lower(btrim(p_email));
begin
  if email is null or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or not isfinite(received) or received>now_at+interval '1 minute' or received<now_at-interval '60 days'
    then raise exception 'check recipient and received date' using errcode='22023';end if;
  select * into rule from private.privacy_request_rules where request_type=p_type;
  if not found then raise exception 'unknown privacy request type' using errcode='22023';end if;
  insert into private.privacy_requests(type,requester_email,requester_phone,description,identity_check,received_at,due_by,legal_basis,intake_by)
    values(p_type,email,coalesce(nullif(btrim(p_phone),''),'not_provided'),
      internal.privacy_text(p_description,10,2000)||E'\n\nIntake note: '||internal.privacy_text(p_note,10,1000),
      'manual',received,received+make_interval(days=>rule.days),rule.source,actor) returning * into r;
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,actor,'recorded',1);
  perform internal.staff_actor('dsar:manage');
  return jsonb_build_object('id',r.id,'due_by',r.due_by);
end$$;
create function api.record_frontend_privacy_intake(p_type text,p_email text,p_phone text,p_description text,p_note text,p_received timestamptz default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.record_frontend_privacy_intake(p_type,p_email,p_phone,p_description,p_note,p_received)$$;

create function internal.get_frontend_privacy_queue(p_view text default 'open',p_page integer default 1)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('dsar:manage');now_at timestamptz:=clock_timestamp();result jsonb;
begin
  if p_view is null or p_view not in('open','due_soon','overdue','mine','closed') or p_page is null or p_page not between 1 and 100000
    then raise exception 'valid privacy queue filters required' using errcode='22023';end if;
  with filtered as (
    select x.*,case when p_view='closed' then -extract(epoch from x.created_at) else extract(epoch from x.effective_due_at) end sort_key
      from private.privacy_requests x
      where case when p_view='closed' then x.status in('completed','rejected') else x.status in('submitted','identity_pending','in_progress') end
        and (p_view<>'mine' or x.assigned_to=actor)
        and (p_view<>'overdue' or x.effective_due_at<now_at)
        and (p_view<>'due_soon' or x.effective_due_at>=now_at and x.effective_due_at<now_at+interval '7 days')
  ), visible as (
    select x.* from filtered x order by sort_key,id limit 25 offset (p_page-1)*25
  )
  select jsonb_build_object('actor_id',actor,'total',(select count(*) from filtered),
    'overdue',(select count(*) from private.privacy_requests where status in('submitted','identity_pending','in_progress') and effective_due_at<now_at),
    'due_soon',(select count(*) from private.privacy_requests where status in('submitted','identity_pending','in_progress') and effective_due_at>=now_at and effective_due_at<now_at+interval '7 days'),
    'rules',(select jsonb_agg(jsonb_build_object('request_type',r.request_type,'extension_days',r.extension_days,'statutory',r.statutory) order by r.request_type) from private.privacy_request_rules r),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'type',v.type,'description',v.description,'status',v.status,
      'requester_email',v.requester_email,'identity_check',v.identity_check,'identity_verified',v.identity_verified,'revision',v.revision,
      'created_at',v.created_at,'received_at',v.received_at,'due_by',v.due_by,'extended_due_at',v.extended_due_at,'effective_due_at',v.effective_due_at,
      'legal_basis',v.legal_basis,'extension_reason',v.extension_reason,'extension_notified_at',v.extension_notified_at,'assigned_to',v.assigned_to,'assignee_name',p.display_name,
      'response_summary',v.response_summary,'completed_at',v.completed_at,
      'may_process',coalesce(v.subject_user_id<>actor,true) and not exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(v.requester_email)))
      order by v.sort_key,v.id) from visible v left join private.profiles p on p.account_id=v.assigned_to),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('dsar:manage');return result;
end$$;
create function api.get_frontend_privacy_queue(p_view text default 'open',p_page integer default 1)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_privacy_queue(p_view,p_page)$$;

create function internal.process_frontend_privacy_request(p_case uuid,p_revision integer,p_action text,p_note text default null,p_assignee uuid default null,p_attestation text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
end$$;
create function api.process_frontend_privacy_request(p_case uuid,p_revision integer,p_action text,p_note text default null,p_assignee uuid default null,p_attestation text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.process_frontend_privacy_request(p_case,p_revision,p_action,p_note,p_assignee,p_attestation)$$;

create function internal.claim_frontend_privacy_notice()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare now_at timestamptz:=clock_timestamp();result jsonb;
begin
  with due as (
    select j.id from private.privacy_notice_jobs j join private.privacy_requests r on r.id=j.request_id
    where j.delivered_at is null and j.attempts<8 and j.next_attempt_at<=now_at
      and (j.locked_until is null or j.locked_until<now_at)
      and (r.identity_check='manual' or exists(select 1 from auth.users u where u.id=r.subject_user_id and u.email_confirmed_at is not null
        and not u.is_anonymous and u.deleted_at is null and lower(u.email)=lower(r.requester_email)))
    order by j.next_attempt_at,j.id limit 1 for update of j skip locked
  ), claimed as (
    update private.privacy_notice_jobs j set claim_token=gen_random_uuid(),locked_until=now_at+interval '90 seconds',attempts=attempts+1
    from due where j.id=due.id returning j.*
  )
  select jsonb_build_object('id',j.id,'request_id',r.id,'kind',j.kind,'recipient',r.requester_email,'claim_token',j.claim_token,'locked_until',j.locked_until,
    'due',case when j.kind='extended' then r.extended_due_at when j.kind='submitted' then r.due_by end,
    'reason',case when j.kind='extended' then r.extension_reason end)
    into result from claimed j join private.privacy_requests r on r.id=j.request_id;
  return result;
end$$;
create function api.claim_frontend_privacy_notice()
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.claim_frontend_privacy_notice()$$;

create function internal.complete_frontend_privacy_notice(p_job uuid,p_claim uuid,p_delivered boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j private.privacy_notice_jobs;now_at timestamptz:=clock_timestamp();
begin
  if p_delivered is null then raise exception 'delivery outcome required' using errcode='22023';end if;
  select * into j from private.privacy_notice_jobs where id=p_job for update;
  if not found or j.claim_token is distinct from p_claim or j.delivered_at is not null or j.locked_until<=now_at
    or j.claim_token is null then return false;end if;
  update private.privacy_notice_jobs set claim_token=null,locked_until=null,
    delivered_at=case when p_delivered then now_at end,
    next_attempt_at=now_at+make_interval(mins=>least(360,1<<j.attempts)) where id=j.id;
  if p_delivered and j.kind='extended' then
    update private.privacy_requests set extension_notified_at=now_at where id=j.request_id and extension_notified_at is null;
  end if;
  return true;
end$$;
create function api.complete_frontend_privacy_notice(p_job uuid,p_claim uuid,p_delivered boolean)
returns boolean language sql security invoker set search_path=pg_catalog as $$select internal.complete_frontend_privacy_notice(p_job,p_claim,p_delivered)$$;

-- Fixed, reviewed export datasets. No caller-provided column names or
-- queries; every branch is bound to the case's verified account. Security
-- material, storage keys, provider payloads, and counterpart contacts are
-- deliberately outside this projection.
create function internal.frontend_privacy_export_data(p_subject uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare entry record;items jsonb;row_count integer;result jsonb:='{}';size_so_far bigint:=0;
begin
  for entry in select * from (values
    ('profile',$q$select account_id,display_name,bio,legal_first_name,legal_last_name,legal_name_locked_at,created_at,updated_at from private.profiles where account_id=$1$q$),
    ('account',$q$select id,email,email_confirmed_at,phone,phone_confirmed_at,created_at,last_sign_in_at from auth.users where id=$1 and deleted_at is null$q$),
    ('listing_drafts',$q$select category_key,price_mode,price_cents,price_negotiable,revision,expires_at from private.listing_price_drafts where owner_id=$1$q$),
    ('posts',$q$select p.id,p.kind,p.area,p.category_key,p.activity_key,p.title,p.description,p.province_id,p.city_id,p.locality_label,
      p.status,p.status_reason,p.created_at,p.submitted_at,p.published_at,p.visible_until,p.edit_of,
      l.price_mode,l.price_cents,l.price_negotiable,l.attributes,b.business_type,e.starts_at,e.ends_at,e.timezone,
      s.slug,d.data presentation,d.contacts contact_details,c.channels
      from private.posts p left join private.listing_details l on l.post_id=p.id left join private.business_details b on b.post_id=p.id
      left join private.event_details e on e.post_id=p.id left join private.post_slugs s on s.post_id=p.id
      left join private.post_presentations d on d.post_id=p.id left join private.post_contacts c on c.post_id=p.id
      where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('post_reviews',$q$select m.post_id,m.edit_id,m.decision,m.reason,m.decided_at,m.price_only
      from private.moderation_log m join private.posts p on p.id=m.post_id where p.owner_id=$1 order by m.decided_at,m.id$q$),
    ('media_metadata',$q$select id,kind,size_bytes,mime,width,height,state,created_at,deleted_at from private.media_objects where owner_id=$1 order by created_at,id$q$),
    ('payments',$q$select id,product_kind,target_post_id,amount_cents,currency,status,fulfillment_status,merchant_reference,provider,created_at,completed_at
      from private.payments where owner_id=$1 order by created_at,id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason
      from private.post_activations where owner_id=$1 order by activated_at,id$q$),
    ('introductory_trials',$q$select post_id,trial_entitlement_id,claimed_at,converted_at
      from private.post_trial_claims where owner_id=$1 order by claimed_at,post_id$q$),
    ('posting_terms',$q$select version,document_hash,accepted_at from private.posting_terms_acceptances where owner_id=$1 order by accepted_at,version$q$),
    ('verification_cases',$q$select id,kind,status,created_at from private.evidence_cases where subject_id=$1 order by created_at,id$q$),
    ('verification_reviews',$q$select r.case_id,r.reason,r.decision,r.created_at from private.verification_return_requests r join private.evidence_cases c on c.id=r.case_id
      where c.subject_id=$1 order by r.created_at,r.id$q$),
    ('evidence_metadata',$q$select id,case_id,purpose,state,size_bytes,created_at,retain_until,deleted_at
      from private.evidence_artifacts where owner_id=$1 order by created_at,id$q$),
    ('phone_verification',$q$select phone,verified_at,contact_changed_at,revoked_at from private.verification_phone_proofs where owner_id=$1 order by verified_at,id$q$),
    ('locality_verification',$q$select province_id,city_id,assurance,confirmed_at from private.verification_localities where owner_id=$1$q$),
    ('enquiries_sent',$q$select id,post_id,message,created_at from private.enquiries where sender_account_id=$1 order by created_at,id$q$),
    ('enquiries_received',$q$select id,post_id,message,status,created_at from private.enquiries where owner_id=$1 order by created_at,id$q$),
    ('notifications',$q$select id,kind,post_id,created_at,read_at from private.notifications where account_id=$1 order by created_at,id$q$),
    ('reports_submitted',$q$select id,post_id,coalesce(frontend_reason,category) category,description,status,created_at,resolved_at
      from private.reports where reporter_id=$1 order by created_at,id$q$),
    ('moderation_decisions',$q$select id,kind,reason,starts_at,ends_at,active from private.frontend_appealable_actions
      where account_id=$1 order by starts_at,id$q$),
    ('appeals',$q$select id,action_id,kind,reason,status,reviewer_rationale,created_at,resolved_at from private.frontend_appeals
      where appellant_id=$1 order by created_at,id$q$),
    ('organisation_applications',$q$select id,organisation_id,programme_id,post_id,reason,member_reference,share_representative_name,consented_at,
      status,info_request,info_response,decision_at,decision_note,created_at from private.organisation_applications where applicant_id=$1 order by created_at,id$q$),
    ('organisation_affiliations',$q$select a.id,a.organisation_id,a.programme_id,a.post_id,a.affiliation_type,a.status,a.confirmed_at,a.revoked_at,a.revoke_reason
      from private.organisation_affiliations a join private.posts p on p.id=a.post_id where p.owner_id=$1 order by a.created_at,a.id$q$),
    ('organisation_roles',$q$select organisation_id,role,created_at from private.organisation_admins where account_id=$1 order by created_at,organisation_id$q$),
    ('sponsorships',$q$select id,organisation_id,post_id,sponsor_type,status,starts_at,ends_at,ended_at,end_reason
      from private.organisation_sponsorships where owner_id=$1 order by created_at,id$q$),
    ('partner_account',$q$select id,code,status,commission_bps,created_at,updated_at from private.partners where account_id=$1 order by created_at,id$q$),
    ('partner_commissions',$q$select c.id,c.base_cents,c.rate_bps,c.amount_cents,c.status,c.eligible_at,c.approved_at,c.paid_at,c.reversed_at
      from private.partner_commissions c join private.partners p on p.id=c.partner_id where p.account_id=$1 order by c.created_at,c.id$q$),
    ('acquisition',$q$select source,campaign,landing_path,referrer_host,first_touch_at,recorded_at from private.account_acquisitions where account_id=$1$q$),
    ('account_closure',$q$select closed_at,evidence_delete_after from private.account_closures where user_id=$1$q$),
    ('data_requests',$q$select id,type,description,status,received_at,due_by,extended_due_at,extension_reason,response_summary,completed_at
      from private.privacy_requests where subject_user_id=$1 order by received_at,id$q$)
  ) as registry(dataset,statement) loop
    execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb),count(*) from ('||entry.statement||' limit 2501)x'
      into items,row_count using p_subject;
    size_so_far:=size_so_far+octet_length(items::text);
    if row_count>2500 or size_so_far>4194304 then raise exception 'privacy export exceeds the direct delivery limit' using errcode='PT413';end if;
    result:=result||jsonb_build_object(entry.dataset,items);
  end loop;
  return result;
end$$;
revoke all on function internal.frontend_privacy_export_data(uuid) from public,anon,authenticated,service_role;
create function internal.export_frontend_privacy_request(p_case uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;result jsonb;
begin
  select * into r from private.privacy_requests where id=p_case for share;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or r.status not in('in_progress','completed') or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  result:=jsonb_build_object('request_id',r.id,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',clock_timestamp(),'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,
    'datasets',case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end);
  perform internal.staff_actor('dsar:manage');
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,actor,'exported',r.revision);
  return result;
end$$;
create function api.export_frontend_privacy_request(p_case uuid,p_revision integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.export_frontend_privacy_request(p_case,p_revision)$$;

do $$declare signature text;ns text;begin
  foreach signature in array array['record_frontend_privacy_intake(text,text,text,text,text,timestamptz)','get_frontend_privacy_queue(text,integer)','process_frontend_privacy_request(uuid,integer,text,text,uuid,text)','export_frontend_privacy_request(uuid,integer)'] loop
    foreach ns in array array['api','internal'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated,service_role',ns,signature);
      execute format('grant execute on function %I.%s to authenticated',ns,signature);
    end loop;
  end loop;
  foreach signature in array array['claim_frontend_privacy_notice()','complete_frontend_privacy_notice(uuid,uuid,boolean)'] loop
    foreach ns in array array['api','internal'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated,service_role',ns,signature);
      execute format('grant execute on function %I.%s to service_role',ns,signature);
    end loop;
  end loop;
end$$;
do $$declare body text;begin
  body:=replace(pg_get_viewdef('private.frontend_staff_audit_events'::regclass,true),E'\r\n',E'\n');
  if md5(body)<>'733c54cd0eeeba6b0bb5cd6e0f4b02d3' then raise exception 'privacy audit view drift';end if;
  execute 'create or replace view private.frontend_staff_audit_events with(security_invoker=true) as '||rtrim(body,E';\n ')||$audit$
    union all select 'privacy_request:'||e.id,e.occurred_at,e.actor_id,e.request_id,'case','privacy:'||e.action,null
      from private.privacy_request_events e
  $audit$;
end$$;
revoke all on private.frontend_staff_audit_events from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
