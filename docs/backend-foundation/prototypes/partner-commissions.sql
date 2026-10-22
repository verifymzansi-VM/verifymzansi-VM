-- Referral partners, first-touch account attribution and commissions.
-- Attribution is first touch, recorded by the member's own session within
-- seven days of sign-up; self-referral attributes nothing. A completed payment
-- by an attributed member creates one pending commission (default 20%); it
-- becomes payable after 30 days if the payment still stands, and a refund or
-- chargeback reverses it. Partners see totals and their own commissions only,
-- never who they referred. Staff manage partners with partner:manage (admin,
-- recent MFA); payouts happen outside the platform and are recorded here.

insert into private.staff_capabilities(role,capability,requires_recent_mfa) values('admin','partner:manage',true);

create table private.partners (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null unique references auth.users(id) on delete restrict,
  code text not null unique check(code ~ '^[A-Z0-9]{4,16}$'),
  status text not null default 'pending' check(status in('pending','active','suspended')),
  commission_bps integer check(commission_bps is null or commission_bps between 0 and 5000),
  revision integer not null default 1 check(revision between 1 and 2147483647),
  created_by uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
alter table private.partners enable row level security;
revoke all on private.partners from public,anon,authenticated,service_role;

create table private.account_acquisitions (
  account_id uuid primary key references auth.users(id) on delete cascade,
  source text not null check(source in('direct','organic','social','paid_campaign','strategic_invite','partner',
    'organisation')),
  partner_id uuid references private.partners(id) on delete restrict,
  organisation_id uuid references private.organisations(id) on delete set null,
  campaign text check(campaign is null or campaign ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  landing_path text check(landing_path is null or (char_length(landing_path)<=300
    and landing_path ~ '^/[A-Za-z0-9/_.~-]*$')),
  referrer_host text check(referrer_host is null or referrer_host ~ '^[a-z0-9-]+([.][a-z0-9-]+)+$'
    and char_length(referrer_host)<=200),
  utm jsonb not null default '{}' check(jsonb_typeof(utm)='object'),
  first_touch_at timestamptz,
  recorded_at timestamptz not null default statement_timestamp(),
  check((source='partner')=(partner_id is not null)),
  check(source<>'organisation' or organisation_id is not null)
);
create index account_acquisitions_partner_idx on private.account_acquisitions(partner_id) where partner_id is not null;
create index account_acquisitions_organisation_idx on private.account_acquisitions(organisation_id)
  where organisation_id is not null;
alter table private.account_acquisitions enable row level security;
revoke all on private.account_acquisitions from public,anon,authenticated,service_role;

create table private.partner_commissions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  partner_id uuid not null references private.partners(id) on delete restrict,
  payment_id uuid not null unique references private.payments(id) on delete restrict,
  referred_account_id uuid not null references auth.users(id) on delete restrict,
  base_cents bigint not null check(base_cents>0),
  rate_bps integer not null check(rate_bps between 0 and 5000),
  amount_cents bigint not null check(amount_cents>=0),
  status text not null default 'pending' check(status in('pending','approved','paid','reversed')),
  eligible_at timestamptz not null,
  approved_at timestamptz,
  approved_by uuid,
  paid_at timestamptz,
  paid_by uuid,
  paid_reference text check(paid_reference is null or internal.plain_text_valid(paid_reference,3,120,false)),
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text check(reversal_reason is null or internal.plain_text_valid(reversal_reason,5,500,true)),
  created_at timestamptz not null default statement_timestamp(),
  check(amount_cents=floor(base_cents::numeric*rate_bps/10000)),
  check((status in('approved','paid') or (status='reversed' and approved_at is not null))=(approved_at is not null)),
  check((paid_at is null)=(paid_by is null) and (paid_at is null)=(paid_reference is null)),
  check(status<>'paid' or paid_at is not null),
  check(status='reversed' or (paid_at is null)=(status<>'paid')),
  check((status='reversed')=(reversed_at is not null and reversal_reason is not null))
);
create index partner_commissions_partner_idx on private.partner_commissions(partner_id,created_at desc,id desc);
create index partner_commissions_due_idx on private.partner_commissions(eligible_at) where status='pending';
create index partner_commissions_referred_idx on private.partner_commissions(referred_account_id);
alter table private.partner_commissions enable row level security;
revoke all on private.partner_commissions from public,anon,authenticated,service_role;

-- Amounts and parties are fixed; status only moves forward.
create function internal.partner_commission_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.partner_id,new.payment_id,new.referred_account_id,new.base_cents,new.rate_bps,new.amount_cents,
      new.eligible_at,new.created_at) is distinct from (old.id,old.partner_id,old.payment_id,old.referred_account_id,
      old.base_cents,old.rate_bps,old.amount_cents,old.eligible_at,old.created_at)
    or old.status='reversed'
    or (old.status,new.status) not in(('pending','pending'),('pending','approved'),('pending','reversed'),
      ('approved','approved'),('approved','paid'),('approved','reversed'),('paid','paid'),('paid','reversed')) then
    raise exception 'commission history is immutable' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function internal.partner_commission_guard() from public,anon,authenticated,service_role;
create trigger partner_commissions_guard before update on private.partner_commissions
  for each row execute function internal.partner_commission_guard();

create table private.partner_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  partner_id uuid not null references private.partners(id) on delete restrict,
  commission_id uuid references private.partner_commissions(id) on delete restrict,
  actor_id uuid not null,
  action text not null check(action ~ '^[a-z_]{3,60}$'),
  reason text not null check(internal.plain_text_valid(reason,5,500,true)),
  created_at timestamptz not null default statement_timestamp()
);
create index partner_events_partner_idx on private.partner_events(partner_id,created_at desc);
create index partner_events_commission_idx on private.partner_events(commission_id) where commission_id is not null;
alter table private.partner_events enable row level security;
revoke all on private.partner_events from public,anon,authenticated,service_role;
create trigger partner_events_append_only before update on private.partner_events
  for each row execute function internal.organisation_events_append_only();

alter table private.notifications drop constraint notifications_kind_check;
alter table private.notifications add constraint notifications_kind_check check(kind in('enquiry_received',
  'organisation_application_received','organisation_application_decided','organisation_affiliation_ended',
  'organisation_sponsorship_activated','organisation_sponsorship_ended',
  'partner_commission_approved','partner_commission_reversed'));

-- ── Attribution ───────────────────────────────────────────────────────────

create function internal.record_my_acquisition(p_partner_code text,p_organisation_slug text,p_source text,
  p_campaign text,p_landing_path text,p_referrer_host text,p_utm jsonb,p_first_touch_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); x private.account_acquisitions; partner private.partners;
  org uuid; src text;
begin
  if (p_source is not null and p_source not in('direct','organic','social','paid_campaign','strategic_invite'))
    or (p_partner_code is not null and p_partner_code !~ '^[A-Za-z0-9]{4,16}$')
    or (p_organisation_slug is not null and p_organisation_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    or (p_campaign is not null and p_campaign !~ '^[a-z0-9][a-z0-9_-]{0,79}$')
    or (p_landing_path is not null and (char_length(p_landing_path)>300
      or p_landing_path !~ '^/[A-Za-z0-9/_.~-]*$'))
    or (p_referrer_host is not null and (p_referrer_host !~ '^[a-z0-9-]+([.][a-z0-9-]+)+$'
      or char_length(p_referrer_host)>200))
    or p_utm is null or jsonb_typeof(p_utm)<>'object'
    or exists(select 1 from jsonb_each(p_utm) u where u.key not in('utm_source','utm_medium','utm_campaign',
      'utm_term','utm_content') or jsonb_typeof(u.value)<>'string'
      or not internal.plain_text_valid(u.value #>> '{}',1,100,false)) then
    raise exception 'invalid attribution' using errcode='22023',detail='acquisition_invalid'; end if;
  select * into x from private.account_acquisitions a where a.account_id=actor;
  if found then return jsonb_build_object('source',x.source,'recorded',false); end if;
  if not exists(select 1 from auth.users u where u.id=actor and u.created_at>statement_timestamp()-interval '7 days') then
    return jsonb_build_object('source',null,'recorded',false); end if;
  select * into partner from private.partners p where p.code=upper(p_partner_code) and p.status='active'
    and p.account_id<>actor;
  select o.id into org from private.organisations o where o.slug=p_organisation_slug and internal.organisation_listed(o);
  src:=case when partner.id is not null then 'partner' when org is not null then 'organisation'
    else coalesce(p_source,'direct') end;
  insert into private.account_acquisitions(account_id,source,partner_id,organisation_id,campaign,landing_path,
      referrer_host,utm,first_touch_at)
    values(actor,src,partner.id,org,p_campaign,p_landing_path,p_referrer_host,p_utm,
      case when p_first_touch_at between statement_timestamp()-interval '90 days' and statement_timestamp()
        then p_first_touch_at end)
    on conflict(account_id) do nothing;
  select * into x from private.account_acquisitions a where a.account_id=actor;
  return jsonb_build_object('source',x.source,'recorded',x.recorded_at=statement_timestamp());
end;
$$;
revoke all on function internal.record_my_acquisition(text,text,text,text,text,text,jsonb,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function internal.record_my_acquisition(text,text,text,text,text,text,jsonb,timestamptz) to authenticated;
create function api.record_my_acquisition(p_utm jsonb,p_partner_code text default null,
  p_organisation_slug text default null,p_source text default null,p_campaign text default null,
  p_landing_path text default null,p_referrer_host text default null,p_first_touch_at timestamptz default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.record_my_acquisition(p_partner_code,p_organisation_slug,p_source,p_campaign,p_landing_path,
    p_referrer_host,p_utm,p_first_touch_at);
$$;
revoke all on function api.record_my_acquisition(jsonb,text,text,text,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function api.record_my_acquisition(jsonb,text,text,text,text,text,text,timestamptz) to authenticated;

-- ── Commissions follow payments ──────────────────────────────────────────

create function internal.payment_partner_commission()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare acq private.account_acquisitions; partner private.partners; c record;
begin
  if new.status in('refunded','chargeback') then
    for c in select x.id,p.account_id from private.partner_commissions x join private.partners p on p.id=x.partner_id
        where x.payment_id=new.id and x.status<>'reversed' for update of x loop
      update private.partner_commissions set status='reversed',reversed_at=statement_timestamp(),
        reversal_reason='Payment '||new.status where id=c.id;
      perform internal.notify_account(c.account_id,'partner_commission_reversed',c.id,null,null);
    end loop;
    return null;
  end if;
  if new.status<>'complete' then return null; end if;
  select * into acq from private.account_acquisitions a where a.account_id=new.owner_id;
  if acq.partner_id is null then return null; end if;
  select * into partner from private.partners p where p.id=acq.partner_id;
  if partner.status<>'active' or partner.account_id=new.owner_id then return null; end if;
  insert into private.partner_commissions(partner_id,payment_id,referred_account_id,base_cents,rate_bps,amount_cents,
      eligible_at)
    values(partner.id,new.id,new.owner_id,new.amount_cents,coalesce(partner.commission_bps,2000),
      floor(new.amount_cents::numeric*coalesce(partner.commission_bps,2000)/10000),
      statement_timestamp()+interval '30 days')
    on conflict(payment_id) do nothing;
  return null;
end;
$$;
revoke all on function internal.payment_partner_commission() from public,anon,authenticated,service_role;
create trigger payments_partner_commission after update of status on private.payments
  for each row when (old.status is distinct from new.status)
  execute function internal.payment_partner_commission();

-- Server sweep: pending commissions whose 30 days have passed and whose
-- payment still stands become payable.
create function internal.approve_due_commissions(p_limit integer)
returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare c record; n integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'limit 1 to 1000' using errcode='22023'; end if;
  for c in select x.id,p.account_id from private.partner_commissions x
      join private.payments pay on pay.id=x.payment_id and pay.status='complete'
      join private.partners p on p.id=x.partner_id
      where x.status='pending' and x.eligible_at<=statement_timestamp()
      order by x.eligible_at,x.id limit p_limit for update of x skip locked loop
    update private.partner_commissions set status='approved',approved_at=statement_timestamp() where id=c.id;
    perform internal.notify_account(c.account_id,'partner_commission_approved',c.id,null,null);
    n:=n+1;
  end loop;
  return n;
end;
$$;
revoke all on function internal.approve_due_commissions(integer) from public,anon,authenticated,service_role;
grant execute on function internal.approve_due_commissions(integer) to service_role;
create function api.approve_due_commissions(p_limit integer)
returns integer language sql security invoker set search_path=pg_catalog as $$
  select internal.approve_due_commissions(p_limit);
$$;
revoke all on function api.approve_due_commissions(integer) from public,anon,authenticated,service_role;
grant execute on function api.approve_due_commissions(integer) to service_role;

-- ── Partner ───────────────────────────────────────────────────────────────

create function internal.my_partner_dashboard()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); p private.partners;
begin
  select * into p from private.partners x where x.account_id=actor;
  if not found then return null; end if;
  return jsonb_build_object('code',p.code,'status',p.status,'rate_bps',coalesce(p.commission_bps,2000),
    'referrals',(select count(*) from private.account_acquisitions a where a.partner_id=p.id),
    'paying_referrals',(select count(distinct c.referred_account_id) from private.partner_commissions c
      where c.partner_id=p.id and c.status<>'reversed'),
    'totals',(select coalesce(jsonb_object_agg(t.status,t.total::text),'{}') from (select c.status,sum(c.amount_cents) total
      from private.partner_commissions c where c.partner_id=p.id group by c.status) t),
    'recent',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'amount_cents',c.amount_cents::text,
        'base_cents',c.base_cents::text,'status',c.status,'created_at',c.created_at,'eligible_at',c.eligible_at,
        'paid_at',c.paid_at) order by c.created_at desc,c.id desc),'[]')
      from (select * from private.partner_commissions x where x.partner_id=p.id
        order by x.created_at desc,x.id desc limit 50) c));
end;
$$;
revoke all on function internal.my_partner_dashboard() from public,anon,authenticated,service_role;
grant execute on function internal.my_partner_dashboard() to authenticated;
create function api.my_partner_dashboard()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.my_partner_dashboard();
$$;
revoke all on function api.my_partner_dashboard() from public,anon,authenticated,service_role;
grant execute on function api.my_partner_dashboard() to authenticated;

-- ── Staff ─────────────────────────────────────────────────────────────────

-- create (pending), activate (requires a current verified identity, since
-- payouts go to a known person), suspend, set_rate (null = default).
create function internal.staff_save_partner(p_account uuid,p_action text,p_code text,p_commission_bps integer,
  p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('partner:manage'); p private.partners;
begin
  perform internal.organisation_reason(p_reason);
  if p_account is null or p_account=actor then
    raise exception 'staff cannot manage their own partner record' using errcode='42501',detail='self_partner'; end if;
  perform internal.lock_verification_subject(p_account);
  select * into p from private.partners x where x.account_id=p_account for update;
  actor:=internal.staff_actor('partner:manage');
  if p_commission_bps is not null and p_commission_bps not between 0 and 5000 then
    raise exception 'invalid rate' using errcode='22023',detail='partner_invalid'; end if;
  if p_action='create' then
    if p.id is not null then raise exception 'already a partner' using errcode='PT409',detail='partner_exists'; end if;
    if p_code is null or p_code !~ '^[A-Z0-9]{4,16}$' then
      raise exception 'invalid code' using errcode='22023',detail='partner_invalid'; end if;
    if not exists(select 1 from private.current_account_access u where u.id=p_account) then
      raise exception 'account unavailable' using errcode='PT409',detail='partner_account_unavailable'; end if;
    if exists(select 1 from private.partners x where x.code=p_code) then
      raise exception 'code taken' using errcode='PT409',detail='partner_code_taken'; end if;
    insert into private.partners(account_id,code,commission_bps,created_by) values(p_account,p_code,p_commission_bps,actor)
      returning * into p;
  elsif p.id is null then
    raise exception 'partner not found' using errcode='PT404',detail='partner_unavailable';
  elsif p_action='activate' then
    if internal.current_verified_identity(p_account) is null then
      raise exception 'verified identity required' using errcode='PT409',detail='verification_required'; end if;
    update private.partners set status='active',revision=revision+1,updated_at=statement_timestamp()
      where id=p.id returning * into p;
  elsif p_action='suspend' then
    update private.partners set status='suspended',revision=revision+1,updated_at=statement_timestamp()
      where id=p.id returning * into p;
  elsif p_action='set_rate' then
    update private.partners set commission_bps=p_commission_bps,revision=revision+1,updated_at=statement_timestamp()
      where id=p.id returning * into p;
  else
    raise exception 'unknown action' using errcode='22023',detail='partner_invalid';
  end if;
  insert into private.partner_events(partner_id,actor_id,action,reason) values(p.id,actor,'partner_'||p_action,p_reason);
  return jsonb_build_object('id',p.id,'code',p.code,'status',p.status,'commission_bps',p.commission_bps,
    'revision',p.revision);
end;
$$;
revoke all on function internal.staff_save_partner(uuid,text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.staff_save_partner(uuid,text,text,integer,text) to authenticated;
create function api.staff_save_partner(p_account uuid,p_action text,p_reason text,p_code text default null,
  p_commission_bps integer default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.staff_save_partner(p_account,p_action,p_code,p_commission_bps,p_reason);
$$;
revoke all on function api.staff_save_partner(uuid,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function api.staff_save_partner(uuid,text,text,text,integer) to authenticated;

-- approve (only once due and while the payment stands), mark_paid (with the
-- external payout reference), reverse (with reason).
create function internal.staff_decide_commission(p_commission uuid,p_action text,p_reference text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('partner:manage'); c private.partner_commissions; owner uuid;
begin
  perform internal.organisation_reason(p_reason);
  select * into c from private.partner_commissions x where x.id=p_commission for update;
  if not found then raise exception 'commission not found' using errcode='PT404',detail='commission_unavailable'; end if;
  actor:=internal.staff_actor('partner:manage');
  select p.account_id into owner from private.partners p where p.id=c.partner_id;
  if owner=actor or c.referred_account_id=actor then
    raise exception 'staff cannot decide their own commission' using errcode='42501',detail='self_partner'; end if;
  if p_action='approve' then
    if c.status<>'pending' or c.eligible_at>statement_timestamp()
      or not exists(select 1 from private.payments pay where pay.id=c.payment_id and pay.status='complete') then
      raise exception 'commission is not due' using errcode='PT409',detail='commission_state'; end if;
    update private.partner_commissions set status='approved',approved_at=statement_timestamp(),approved_by=actor
      where id=c.id returning * into c;
    perform internal.notify_account(owner,'partner_commission_approved',c.id,null,null);
  elsif p_action='mark_paid' then
    if c.status<>'approved' then
      raise exception 'commission is not approved' using errcode='PT409',detail='commission_state'; end if;
    if p_reference is null or not internal.plain_text_valid(p_reference,3,120,false) then
      raise exception 'payout reference required' using errcode='22023',detail='commission_invalid'; end if;
    update private.partner_commissions set status='paid',paid_at=statement_timestamp(),paid_by=actor,
      paid_reference=p_reference where id=c.id returning * into c;
  elsif p_action='reverse' then
    if c.status='reversed' then
      raise exception 'commission already reversed' using errcode='PT409',detail='commission_state'; end if;
    update private.partner_commissions set status='reversed',reversed_at=statement_timestamp(),reversed_by=actor,
      reversal_reason=p_reason where id=c.id returning * into c;
    perform internal.notify_account(owner,'partner_commission_reversed',c.id,null,null);
  else
    raise exception 'unknown action' using errcode='22023',detail='commission_invalid';
  end if;
  insert into private.partner_events(partner_id,commission_id,actor_id,action,reason)
    values(c.partner_id,c.id,actor,'commission_'||p_action,p_reason);
  return jsonb_build_object('id',c.id,'status',c.status);
end;
$$;
revoke all on function internal.staff_decide_commission(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.staff_decide_commission(uuid,text,text,text) to authenticated;
create function api.staff_decide_commission(p_commission uuid,p_action text,p_reason text,p_reference text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.staff_decide_commission(p_commission,p_action,p_reference,p_reason);
$$;
revoke all on function api.staff_decide_commission(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function api.staff_decide_commission(uuid,text,text,text) to authenticated;

create function internal.staff_list_partners()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('partner:manage');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'account_id',p.account_id,'code',p.code,
      'status',p.status,'commission_bps',p.commission_bps,'revision',p.revision,
      'referrals',(select count(*) from private.account_acquisitions a where a.partner_id=p.id),
      'pending_cents',(select coalesce(sum(c.amount_cents),0)::text from private.partner_commissions c
        where c.partner_id=p.id and c.status='pending'),
      'approved_cents',(select coalesce(sum(c.amount_cents),0)::text from private.partner_commissions c
        where c.partner_id=p.id and c.status='approved')) order by p.created_at desc),'[]')
    from (select * from private.partners x order by x.created_at desc limit 500) p);
end;
$$;
revoke all on function internal.staff_list_partners() from public,anon,authenticated,service_role;
grant execute on function internal.staff_list_partners() to authenticated;
create function api.staff_list_partners()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.staff_list_partners();
$$;
revoke all on function api.staff_list_partners() from public,anon,authenticated,service_role;
grant execute on function api.staff_list_partners() to authenticated;

create function internal.staff_list_commissions(p_partner uuid,p_status text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('partner:manage');
begin
  if p_status is not null and p_status not in('pending','approved','paid','reversed') then
    raise exception 'unknown status' using errcode='22023',detail='commission_invalid'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'partner_id',c.partner_id,'payment_id',c.payment_id,
      'base_cents',c.base_cents::text,'rate_bps',c.rate_bps,'amount_cents',c.amount_cents::text,'status',c.status,
      'eligible_at',c.eligible_at,'approved_at',c.approved_at,'paid_at',c.paid_at,'paid_reference',c.paid_reference,
      'reversed_at',c.reversed_at,'reversal_reason',c.reversal_reason,'created_at',c.created_at)
      order by c.created_at desc,c.id desc),'[]')
    from (select * from private.partner_commissions x where (p_partner is null or x.partner_id=p_partner)
      and (p_status is null or x.status=p_status) order by x.created_at desc,x.id desc limit 500) c);
end;
$$;
revoke all on function internal.staff_list_commissions(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.staff_list_commissions(uuid,text) to authenticated;
create function api.staff_list_commissions(p_partner uuid default null,p_status text default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.staff_list_commissions(p_partner,p_status);
$$;
revoke all on function api.staff_list_commissions(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.staff_list_commissions(uuid,text) to authenticated;
