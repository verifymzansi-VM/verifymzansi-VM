-- Sponsored places and programme showcases. A sponsorship gives one affiliated
-- business owner one business posting place, funded by VerifyMzansi during a
-- founding pilot or by the organisation on a paid programme; the type follows
-- the programme status, never caller input. Places are counted under the
-- organisation row lock; requests beyond capacity wait in arrival order.
-- Each active sponsorship owns exactly one 'sponsorship' entitlement. Ending
-- it revokes that entitlement and takes the posts it funds off the site in
-- the same commit, then fills freed places from the waiting list.
-- Lock order: affiliation, organisation, sponsorship, funded posts, entitlement
-- (activate_post locks a post before entitlements, so posts come first here).

create table private.organisation_sponsorships (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organisation_id uuid not null references private.organisations(id) on delete cascade,
  affiliation_id uuid not null references private.organisation_affiliations(id) on delete cascade,
  post_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  sponsor_type text not null check(sponsor_type in('founding','organisation')),
  status text not null default 'waitlisted' check(status in('active','waitlisted','ended','revoked')),
  starts_at timestamptz,
  ends_at timestamptz,
  entitlement_id uuid unique references private.entitlements(id) on delete restrict,
  requested_by uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  ended_at timestamptz,
  ended_by uuid,
  end_reason text check(end_reason is null or internal.plain_text_valid(end_reason,5,500,true)),
  check(case status
    when 'waitlisted' then entitlement_id is null and starts_at is null and ends_at is null and ended_at is null
    when 'active' then entitlement_id is not null and ends_at>starts_at and ended_at is null and end_reason is null
    else ended_at is not null and end_reason is not null end)
);
create unique index organisation_sponsorships_open_idx on private.organisation_sponsorships(affiliation_id)
  where status in('active','waitlisted');
create index organisation_sponsorships_org_idx on private.organisation_sponsorships(organisation_id,status,created_at,id);
create index organisation_sponsorships_owner_idx on private.organisation_sponsorships(owner_id,created_at desc);
create index organisation_sponsorships_post_idx on private.organisation_sponsorships(post_id) where status='active';
create index organisation_sponsorships_due_idx on private.organisation_sponsorships(ends_at) where status='active';
alter table private.organisation_sponsorships enable row level security;
revoke all on private.organisation_sponsorships from public,anon,authenticated,service_role;

-- Who, what and why are fixed at request time; ended sponsorships are history.
create function internal.sponsorship_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.organisation_id,new.affiliation_id,new.post_id,new.owner_id,new.sponsor_type,new.requested_by,new.created_at)
      is distinct from (old.id,old.organisation_id,old.affiliation_id,old.post_id,old.owner_id,old.sponsor_type,
        old.requested_by,old.created_at)
    or old.status in('ended','revoked')
    or (old.status='active' and new.status='waitlisted')
    or (old.entitlement_id is not null and new.entitlement_id is distinct from old.entitlement_id) then
    raise exception 'sponsorship history is immutable' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function internal.sponsorship_guard() from public,anon,authenticated,service_role;
create trigger organisation_sponsorships_guard before update on private.organisation_sponsorships
  for each row execute function internal.sponsorship_guard();

alter table private.notifications drop constraint notifications_kind_check;
alter table private.notifications add constraint notifications_kind_check check(kind in('enquiry_received',
  'organisation_application_received','organisation_application_decided','organisation_affiliation_ended',
  'organisation_sponsorship_activated','organisation_sponsorship_ended'));

-- Revokes a sponsorship entitlement and takes the posts it funds off the site.
create function internal.release_sponsorship_entitlement(p_entitlement uuid)
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare v_post_ids uuid[];
begin
  if p_entitlement is null then return 0; end if;
  perform p.id from private.posts p where p.id in(select a.post_id from private.post_activations a
    where a.entitlement_id=p_entitlement and a.released_at is null) order by p.id for update of p;
  perform e.id from private.entitlements e where e.id=p_entitlement for update;
  update private.entitlements set status='revoked',revoked_reason='sponsorship_ended'
    where id=p_entitlement and status<>'revoked';
  with released as (
    update private.post_activations a set released_at=statement_timestamp(),release_reason='entitlement_ended'
    where a.entitlement_id=p_entitlement and a.released_at is null returning a.post_id)
  select coalesce(array_agg(post_id) filter(where post_id is not null),'{}') into v_post_ids from released;
  update private.posts set status='expired',status_reason='Sponsorship ended',revision=revision+1
    where id=any(v_post_ids) and status in('live','pending_moderation');
  update private.post_search_documents set is_visible=false where post_id=any(v_post_ids);
  return cardinality(v_post_ids);
end;
$$;
revoke all on function internal.release_sponsorship_entitlement(uuid) from public,anon,authenticated,service_role;

-- Ends one open sponsorship. The caller holds the organisation row lock and
-- fills freed places afterwards. Returns true when an active place was freed.
create function internal.finish_sponsorship(p_id uuid,p_status text,p_reason text,p_actor uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare s private.organisation_sponsorships;
begin
  select * into s from private.organisation_sponsorships where id=p_id for update;
  if not found or s.status not in('active','waitlisted') then return false; end if;
  perform internal.release_sponsorship_entitlement(s.entitlement_id);
  update private.organisation_sponsorships set status=p_status,ended_at=statement_timestamp(),ended_by=p_actor,
    end_reason=p_reason where id=s.id;
  if s.status='active' then
    perform internal.notify_account(s.owner_id,'organisation_sponsorship_ended',s.id,s.post_id,s.organisation_id);
  end if;
  return s.status='active';
end;
$$;
revoke all on function internal.finish_sponsorship(uuid,text,text,uuid) from public,anon,authenticated,service_role;

-- Starts a waiting sponsorship (organisation row lock held). A request whose
-- basis has gone is revoked instead. Starting binds the owner's verified
-- identity to the introductory-trial register, so a sponsored member does not
-- later also receive a public introductory trial (source rule).
create function internal.start_sponsorship(p_id uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare s private.organisation_sponsorships; o private.organisations; ends timestamptz; ent uuid; fingerprint text;
begin
  select * into s from private.organisation_sponsorships where id=p_id for update;
  if not found or s.status<>'waitlisted' then return false; end if;
  perform internal.lock_verification_subject(s.owner_id);
  select * into o from private.organisations where id=s.organisation_id;
  ends:=coalesce(o.programme_ends_at,statement_timestamp()+interval '180 days');
  if not exists(select 1 from private.organisation_affiliations f join private.posts p on p.id=f.post_id
      where f.id=s.affiliation_id and f.status='active' and p.owner_id=s.owner_id)
    or not exists(select 1 from private.current_account_access u where u.id=s.owner_id)
    or ends<=statement_timestamp() + interval '1 day' then
    update private.organisation_sponsorships set status='revoked',ended_at=statement_timestamp(),
      end_reason='Sponsorship basis no longer valid' where id=s.id;
    return false;
  end if;
  insert into private.entitlements(owner_id,source,area,sponsorship_id,slot_capacity,activations_per_period,
      activation_period_days,max_photos,max_videos,starts_at,ends_at)
    values(s.owner_id,'sponsorship','business',s.id,1,10,30,10,1,statement_timestamp(),ends)
    returning id into ent;
  update private.organisation_sponsorships set status='active',starts_at=statement_timestamp(),ends_at=ends,
    entitlement_id=ent where id=s.id;
  fingerprint:=internal.current_verified_identity(s.owner_id);
  if fingerprint is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint,2701));
    insert into private.trial_identities(identity_hmac,owner_id,entitlement_id) values(fingerprint,s.owner_id,ent)
      on conflict(identity_hmac) do nothing;
  end if;
  perform internal.notify_account(s.owner_id,'organisation_sponsorship_activated',s.id,s.post_id,s.organisation_id);
  return true;
end;
$$;
revoke all on function internal.start_sponsorship(uuid) from public,anon,authenticated,service_role;

-- Fills free places in arrival order (organisation row lock held).
create function internal.fill_sponsorship_places(p_org uuid)
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare o private.organisations; used integer; next_id uuid; started integer:=0;
begin
  select * into o from private.organisations where id=p_org;
  if not found or o.programme_status not in('founding_trial','active_paid') then return 0; end if;
  loop
    select count(*) into used from private.organisation_sponsorships where organisation_id=p_org and status='active';
    exit when used>=o.sponsored_capacity;
    select id into next_id from private.organisation_sponsorships where organisation_id=p_org and status='waitlisted'
      order by created_at,id limit 1;
    exit when next_id is null;
    if internal.start_sponsorship(next_id) then started:=started+1; end if;
  end loop;
  return started;
end;
$$;
revoke all on function internal.fill_sponsorship_places(uuid) from public,anon,authenticated,service_role;

-- Programme status, type and capacity changes apply to places immediately.
create function internal.organisation_sponsorship_rules()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare s record; kind text:=case new.programme_status when 'founding_trial' then 'founding'
  when 'active_paid' then 'organisation' end;
begin
  if new.programme_status is distinct from old.programme_status then
    for s in select id from private.organisation_sponsorships where organisation_id=new.id
        and status in('active','waitlisted') and sponsor_type is distinct from kind order by created_at,id loop
      perform internal.finish_sponsorship(s.id,'ended','Programme status changed',null);
    end loop;
  end if;
  perform internal.fill_sponsorship_places(new.id);
  return null;
end;
$$;
revoke all on function internal.organisation_sponsorship_rules() from public,anon,authenticated,service_role;
create trigger organisations_sponsorship_rules after update of programme_status,sponsored_capacity
  on private.organisations for each row
  when (new.programme_status is distinct from old.programme_status or new.sponsored_capacity<>old.sponsored_capacity)
  execute function internal.organisation_sponsorship_rules();

-- An affiliation that stops being active ends its sponsorship.
create function internal.affiliation_sponsorship_rules()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare s record; freed boolean:=false;
begin
  perform 1 from private.organisations o where o.id=new.organisation_id for update;
  for s in select id from private.organisation_sponsorships where affiliation_id=new.id
      and status in('active','waitlisted') loop
    freed:=internal.finish_sponsorship(s.id,'revoked','Affiliation ended',new.revoked_by) or freed;
  end loop;
  if freed then perform internal.fill_sponsorship_places(new.organisation_id); end if;
  return null;
end;
$$;
revoke all on function internal.affiliation_sponsorship_rules() from public,anon,authenticated,service_role;
create trigger organisation_affiliations_sponsorship_rules after update of status on private.organisation_affiliations
  for each row when (old.status='active' and new.status<>'active')
  execute function internal.affiliation_sponsorship_rules();

-- Deleted posts or organisations cascade here: the entitlement must not outlive
-- its sponsorship. Freed places are filled by the next sweep.
create function internal.sponsorship_delete_release()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if old.status='active' then perform internal.release_sponsorship_entitlement(old.entitlement_id); end if;
  return old;
end;
$$;
revoke all on function internal.sponsorship_delete_release() from public,anon,authenticated,service_role;
create trigger organisation_sponsorships_delete_release before delete on private.organisation_sponsorships
  for each row execute function internal.sponsorship_delete_release();

-- ── Organisation administrators and staff ─────────────────────────────────

create function internal.sponsor_business(p_affiliation uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; f private.organisation_affiliations; o private.organisations; owner uuid; open_count integer;
  s private.organisation_sponsorships;
begin
  perform internal.organisation_reason(p_reason);
  select * into f from private.organisation_affiliations where id=p_affiliation;
  if not found then raise exception 'affiliation not found' using errcode='PT404',detail='affiliation_unavailable'; end if;
  actor:=internal.organisation_actor(f.organisation_id);
  select * into f from private.organisation_affiliations where id=f.id for update;
  select * into o from private.organisations where id=f.organisation_id for update;
  actor:=internal.organisation_actor(o.id);
  if f.status<>'active' then
    raise exception 'affiliation is not active' using errcode='PT409',detail='affiliation_state'; end if;
  if o.programme_status not in('founding_trial','active_paid') then
    raise exception 'programme has no sponsored places' using errcode='PT409',detail='programme_inactive'; end if;
  select p.owner_id into owner from private.posts p where p.id=f.post_id and p.kind='business';
  if owner is null or not exists(select 1 from private.current_account_access u where u.id=owner) then
    raise exception 'business owner unavailable' using errcode='PT409',detail='sponsorship_owner_unavailable'; end if;
  if owner=actor then
    raise exception 'own business cannot be sponsored' using errcode='42501',detail='self_sponsorship'; end if;
  if exists(select 1 from private.organisation_sponsorships x where x.affiliation_id=f.id
      and x.status in('active','waitlisted')) then
    raise exception 'business already sponsored or waiting' using errcode='PT409',detail='sponsorship_exists'; end if;
  select count(*) into open_count from private.organisation_sponsorships x where x.organisation_id=o.id
    and x.status in('active','waitlisted');
  if open_count>=o.sponsored_capacity+500 then
    raise exception 'waiting list is full' using errcode='PT409',detail='sponsorship_waitlist_full'; end if;
  insert into private.organisation_sponsorships(organisation_id,affiliation_id,post_id,owner_id,sponsor_type,requested_by)
    values(o.id,f.id,f.post_id,owner,case o.programme_status when 'founding_trial' then 'founding' else 'organisation' end,
      actor) returning * into s;
  perform internal.record_organisation_event(o.id,actor,'sponsorship_requested',s.id,p_reason);
  perform internal.fill_sponsorship_places(o.id);
  select * into s from private.organisation_sponsorships where id=s.id;
  return jsonb_build_object('id',s.id,'status',s.status,'sponsor_type',s.sponsor_type,'ends_at',s.ends_at);
end;
$$;
revoke all on function internal.sponsor_business(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.sponsor_business(uuid,text) to authenticated;
create function api.sponsor_business(p_affiliation uuid,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.sponsor_business(p_affiliation,p_reason);
$$;
revoke all on function api.sponsor_business(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.sponsor_business(uuid,text) to authenticated;

create function internal.end_sponsorship(p_sponsorship uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; s private.organisation_sponsorships;
begin
  perform internal.organisation_reason(p_reason);
  select * into s from private.organisation_sponsorships where id=p_sponsorship;
  if not found then raise exception 'sponsorship not found' using errcode='PT404',detail='sponsorship_unavailable'; end if;
  actor:=internal.organisation_actor(s.organisation_id);
  perform 1 from private.organisations o where o.id=s.organisation_id for update;
  actor:=internal.organisation_actor(s.organisation_id);
  if not exists(select 1 from private.organisation_sponsorships x where x.id=s.id and x.status in('active','waitlisted')) then
    raise exception 'sponsorship already ended' using errcode='PT409',detail='sponsorship_state'; end if;
  if internal.finish_sponsorship(s.id,'ended',p_reason,actor) then
    perform internal.fill_sponsorship_places(s.organisation_id); end if;
  perform internal.record_organisation_event(s.organisation_id,actor,'sponsorship_ended',s.id,p_reason);
  return jsonb_build_object('id',s.id,'status','ended');
end;
$$;
revoke all on function internal.end_sponsorship(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.end_sponsorship(uuid,text) to authenticated;
create function api.end_sponsorship(p_sponsorship uuid,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.end_sponsorship(p_sponsorship,p_reason);
$$;
revoke all on function api.end_sponsorship(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.end_sponsorship(uuid,text) to authenticated;

create function internal.org_list_sponsorships(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.organisation_actor(p_org); o private.organisations;
begin
  select * into o from private.organisations where id=p_org;
  return jsonb_build_object('capacity',o.sponsored_capacity,'programme_status',o.programme_status,
    'active',(select count(*) from private.organisation_sponsorships x where x.organisation_id=p_org and x.status='active'),
    'waitlisted',(select count(*) from private.organisation_sponsorships x where x.organisation_id=p_org
      and x.status='waitlisted'),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'affiliation_id',s.affiliation_id,'post_id',s.post_id,
        'business_name',p.title,'sponsor_type',s.sponsor_type,'status',s.status,'starts_at',s.starts_at,
        'ends_at',s.ends_at,'created_at',s.created_at,'ended_at',s.ended_at,'end_reason',s.end_reason)
        order by s.created_at desc,s.id desc),'[]')
      from (select * from private.organisation_sponsorships x where x.organisation_id=p_org
        order by x.created_at desc,x.id desc limit 500) s
      left join private.posts p on p.id=s.post_id));
end;
$$;
revoke all on function internal.org_list_sponsorships(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.org_list_sponsorships(uuid) to authenticated;
create function api.org_list_sponsorships(p_org uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.org_list_sponsorships(p_org);
$$;
revoke all on function api.org_list_sponsorships(uuid) from public,anon,authenticated,service_role;
grant execute on function api.org_list_sponsorships(uuid) to authenticated;

-- Business owner's own sponsored places (open, and ended in the last 90 days).
create function internal.my_sponsorships()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'post_id',s.post_id,'business_name',p.title,
      'organisation_slug',o.slug,'organisation_name',o.name,'label',o.sponsorship_wording,'status',s.status,
      'starts_at',s.starts_at,'ends_at',s.ends_at,'ended_at',s.ended_at) order by s.created_at desc,s.id desc),'[]')
    from (select * from private.organisation_sponsorships x where x.owner_id=actor
      and (x.status in('active','waitlisted') or x.ended_at>statement_timestamp()-interval '90 days')
      order by x.created_at desc,x.id desc limit 100) s
    join private.organisations o on o.id=s.organisation_id
    left join private.posts p on p.id=s.post_id);
end;
$$;
revoke all on function internal.my_sponsorships() from public,anon,authenticated,service_role;
grant execute on function internal.my_sponsorships() to authenticated;
create function api.my_sponsorships()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.my_sponsorships();
$$;
revoke all on function api.my_sponsorships() from public,anon,authenticated,service_role;
grant execute on function api.my_sponsorships() to authenticated;

-- Server sweep: ends places whose period (or programme) is over, revokes places
-- whose owner lost access, then fills free places.
create function internal.sweep_sponsorships(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s record; o record; ended integer:=0; started integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'limit 1 to 1000' using errcode='22023'; end if;
  for s in select x.id,x.organisation_id,
        case when exists(select 1 from private.current_account_access u where u.id=x.owner_id)
          then 'ended' else 'revoked' end as next_status
      from private.organisation_sponsorships x join private.organisations g on g.id=x.organisation_id
      where x.status='active' and (x.ends_at<=statement_timestamp() or g.programme_ends_at<=statement_timestamp()
        or not exists(select 1 from private.current_account_access u where u.id=x.owner_id))
      order by x.ends_at,x.id limit p_limit loop
    perform 1 from private.organisations g where g.id=s.organisation_id for update;
    if internal.finish_sponsorship(s.id,s.next_status,
        case s.next_status when 'ended' then 'Sponsorship period ended' else 'Owner account unavailable' end,null) then
      ended:=ended+1; end if;
  end loop;
  for o in select g.id from private.organisations g
      where g.programme_status in('founding_trial','active_paid')
        and exists(select 1 from private.organisation_sponsorships w where w.organisation_id=g.id and w.status='waitlisted')
        and (select count(*) from private.organisation_sponsorships a where a.organisation_id=g.id
          and a.status='active')<g.sponsored_capacity
      order by g.id limit 100 loop
    perform 1 from private.organisations g where g.id=o.id for update;
    started:=started+internal.fill_sponsorship_places(o.id);
  end loop;
  return jsonb_build_object('ended',ended,'started',started);
end;
$$;
revoke all on function internal.sweep_sponsorships(integer) from public,anon,authenticated,service_role;
grant execute on function internal.sweep_sponsorships(integer) to service_role;
create function api.sweep_sponsorships(p_limit integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.sweep_sponsorships(p_limit);
$$;
revoke all on function api.sweep_sponsorships(integer) from public,anon,authenticated,service_role;
grant execute on function api.sweep_sponsorships(integer) to service_role;

-- Public "Supported by" badges for up to 100 live business posts.
create function internal.public_post_sponsorships(p_post_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if p_post_ids is null or cardinality(p_post_ids) not between 1 and 100 then
    raise exception 'between 1 and 100 post ids required' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('post_id',s.post_id,'organisation_slug',o.slug,
      'organisation_name',o.name,'label',o.sponsorship_wording) order by s.post_id,o.name),'[]')
    from private.organisation_sponsorships s
    join private.organisations o on o.id=s.organisation_id
    join private.public_eligible_posts e on e.id=s.post_id
    where s.post_id=any(p_post_ids) and s.status='active' and s.starts_at<=statement_timestamp()
      and s.ends_at>statement_timestamp() and internal.organisation_listed(o));
end;
$$;
revoke all on function internal.public_post_sponsorships(uuid[]) from public,anon,authenticated,service_role;
grant execute on function internal.public_post_sponsorships(uuid[]) to anon,authenticated;
create function api.public_post_sponsorships(p_post_ids uuid[])
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.public_post_sponsorships(p_post_ids);
$$;
revoke all on function api.public_post_sponsorships(uuid[]) from public,anon,authenticated,service_role;
grant execute on function api.public_post_sponsorships(uuid[]) to anon,authenticated;

-- ── Programme showcases ───────────────────────────────────────────────────
-- Staff-configured programme spotlights, separate from organic ranking.

create table private.programme_showcases (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organisation_id uuid not null references private.organisations(id) on delete cascade,
  programme_id uuid,
  title text not null check(internal.plain_text_valid(title,3,120,false)),
  placement text not null check(placement in('home','business','tourism','market')),
  enabled boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  max_cards integer not null default 12 check(max_cards between 3 and 48),
  province_id text references private.provinces(id),
  city_id text references private.cities(id),
  display_order integer not null default 100 check(display_order between 0 and 100000),
  sponsored_only boolean not null default false,
  revision integer not null default 1 check(revision between 1 and 2147483647),
  created_by uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key(programme_id,organisation_id) references private.organisation_programmes(id,organisation_id),
  check(ends_at>starts_at and ends_at<=starts_at+interval '366 days')
);
create index programme_showcases_placement_idx on private.programme_showcases(placement,display_order)
  where enabled;
create index programme_showcases_org_idx on private.programme_showcases(organisation_id);
alter table private.programme_showcases enable row level security;
revoke all on private.programme_showcases from public,anon,authenticated,service_role;

-- Creates (p_showcase null) or replaces a showcase, revision-fenced.
create function internal.save_programme_showcase(p_org uuid,p_showcase uuid,p_expected_revision integer,
  p_title text,p_placement text,p_enabled boolean,p_starts_at timestamptz,p_ends_at timestamptz,p_max_cards integer,
  p_display_order integer,p_sponsored_only boolean,p_reason text,p_province text,p_city text,p_programme uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage'); x private.programme_showcases;
begin
  perform internal.organisation_reason(p_reason);
  perform 1 from private.organisations o where o.id=p_org for update;
  if not found then raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable'; end if;
  actor:=internal.staff_actor('organisation:manage');
  if p_title is null or not internal.plain_text_valid(p_title,3,120,false)
    or p_placement is null or p_placement not in('home','business','tourism','market')
    or p_enabled is null or p_sponsored_only is null or p_starts_at is null or p_ends_at is null
    or p_ends_at<=p_starts_at or p_ends_at>p_starts_at+interval '366 days'
    or p_max_cards is null or p_max_cards not between 3 and 48
    or p_display_order is null or p_display_order not between 0 and 100000
    or (p_city is not null and not exists(select 1 from private.cities c where c.id=p_city
      and (p_province is null or c.province_id=p_province)))
    or (p_province is not null and not exists(select 1 from private.provinces v where v.id=p_province))
    or (p_programme is not null and not exists(select 1 from private.organisation_programmes g
      where g.id=p_programme and g.organisation_id=p_org)) then
    raise exception 'invalid showcase' using errcode='22023',detail='showcase_invalid'; end if;
  if p_showcase is null then
    if (select count(*) from private.programme_showcases s where s.organisation_id=p_org)>=20 then
      raise exception 'showcase limit reached' using errcode='PT409',detail='showcase_limit'; end if;
    insert into private.programme_showcases(organisation_id,programme_id,title,placement,enabled,starts_at,ends_at,
        max_cards,province_id,city_id,display_order,sponsored_only,created_by)
      values(p_org,p_programme,p_title,p_placement,p_enabled,p_starts_at,p_ends_at,p_max_cards,p_province,p_city,
        p_display_order,p_sponsored_only,actor) returning * into x;
  else
    update private.programme_showcases set programme_id=p_programme,title=p_title,placement=p_placement,
        enabled=p_enabled,starts_at=p_starts_at,ends_at=p_ends_at,max_cards=p_max_cards,province_id=p_province,
        city_id=p_city,display_order=p_display_order,sponsored_only=p_sponsored_only,revision=revision+1,
        updated_at=statement_timestamp()
      where id=p_showcase and organisation_id=p_org and revision=p_expected_revision returning * into x;
    if not found then
      if exists(select 1 from private.programme_showcases s where s.id=p_showcase and s.organisation_id=p_org) then
        raise exception 'showcase changed' using errcode='PT409',detail='showcase_changed'; end if;
      raise exception 'showcase not found' using errcode='PT404',detail='showcase_unavailable';
    end if;
  end if;
  perform internal.record_organisation_event(p_org,actor,'showcase_saved',x.id,p_reason);
  return jsonb_build_object('id',x.id,'revision',x.revision);
end;
$$;
revoke all on function internal.save_programme_showcase(uuid,uuid,integer,text,text,boolean,timestamptz,timestamptz,
  integer,integer,boolean,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.save_programme_showcase(uuid,uuid,integer,text,text,boolean,timestamptz,timestamptz,
  integer,integer,boolean,text,text,text,uuid) to authenticated;
create function api.save_programme_showcase(p_org uuid,p_title text,p_placement text,p_enabled boolean,
  p_starts_at timestamptz,p_ends_at timestamptz,p_max_cards integer,p_display_order integer,p_sponsored_only boolean,
  p_reason text,p_showcase uuid default null,p_expected_revision integer default null,p_province text default null,
  p_city text default null,p_programme uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_programme_showcase(p_org,p_showcase,p_expected_revision,p_title,p_placement,p_enabled,
    p_starts_at,p_ends_at,p_max_cards,p_display_order,p_sponsored_only,p_reason,p_province,p_city,p_programme);
$$;
revoke all on function api.save_programme_showcase(uuid,text,text,boolean,timestamptz,timestamptz,integer,integer,
  boolean,text,uuid,integer,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function api.save_programme_showcase(uuid,text,text,boolean,timestamptz,timestamptz,integer,integer,
  boolean,text,uuid,integer,text,text,uuid) to authenticated;

create function internal.staff_list_programme_showcases(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'programme_id',s.programme_id,'title',s.title,
      'placement',s.placement,'enabled',s.enabled,'starts_at',s.starts_at,'ends_at',s.ends_at,'max_cards',s.max_cards,
      'province',s.province_id,'city',s.city_id,'display_order',s.display_order,'sponsored_only',s.sponsored_only,
      'revision',s.revision,'updated_at',s.updated_at) order by s.display_order,s.created_at),'[]')
    from private.programme_showcases s where s.organisation_id=p_org);
end;
$$;
revoke all on function internal.staff_list_programme_showcases(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.staff_list_programme_showcases(uuid) to authenticated;
create function api.staff_list_programme_showcases(p_org uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.staff_list_programme_showcases(p_org);
$$;
revoke all on function api.staff_list_programme_showcases(uuid) from public,anon,authenticated,service_role;
grant execute on function api.staff_list_programme_showcases(uuid) to authenticated;

-- Up to two live showcases for a placement. Cards are live business posts of
-- the programme with a ready cover image; a showcase with fewer than three
-- cards is hidden (source default programmeMinItems).
create function internal.public_programme_showcases(p_placement text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if p_placement is null or p_placement not in('home','business','tourism','market') then
    raise exception 'unknown placement' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'organisation_slug',v.slug,
      'organisation_name',v.name,'cards',v.cards) order by v.display_order,v.id),'[]')
    from (select s.id,s.title,s.display_order,o.slug,o.name,c.cards
      from private.programme_showcases s
      join private.organisations o on o.id=s.organisation_id
      cross join lateral (select jsonb_agg(jsonb_build_object('post_id',k.id,'title',k.title,'city',k.city_id,
          'cover_object_key',k.object_key,'sponsored',k.sponsored) order by k.sponsored desc,k.title,k.id) cards,
          count(*) n
        from (select q.* from (select p.id,p.title,p.city_id,m.object_key,
              exists(select 1 from private.organisation_sponsorships x where x.post_id=p.id and x.organisation_id=o.id
                and x.status='active' and x.starts_at<=statement_timestamp()
                and x.ends_at>statement_timestamp()) sponsored
            from private.organisation_affiliations f
            join private.posts p on p.id=f.post_id
            join private.public_eligible_posts e on e.id=p.id
            join private.post_search_documents d on d.post_id=p.id and d.is_visible
              and (d.visible_until is null or d.visible_until>statement_timestamp())
            join private.post_media pm on pm.post_id=p.id and pm.purpose='cover'
            join private.media_objects m on m.id=pm.object_id and m.state='ready' and m.kind='image'
            where f.organisation_id=o.id and f.status='active'
              and (s.programme_id is null or f.programme_id=s.programme_id)
              and (s.province_id is null or p.province_id=s.province_id)
              and (s.city_id is null or p.city_id=s.city_id)) q
          where not s.sponsored_only or q.sponsored
          order by q.sponsored desc,q.title,q.id limit s.max_cards) k) c
      where s.placement=p_placement and s.enabled and s.starts_at<=statement_timestamp()
        and s.ends_at>statement_timestamp() and internal.organisation_listed(o)
        and (s.programme_id is null or exists(select 1 from private.organisation_programmes g
          where g.id=s.programme_id and g.active))
        and c.n>=3
      order by s.display_order,s.id limit 2) v);
end;
$$;
revoke all on function internal.public_programme_showcases(text) from public,anon,authenticated,service_role;
grant execute on function internal.public_programme_showcases(text) to anon,authenticated;
create function api.public_programme_showcases(p_placement text)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.public_programme_showcases(p_placement);
$$;
revoke all on function api.public_programme_showcases(text) from public,anon,authenticated,service_role;
grant execute on function api.public_programme_showcases(text) to anon,authenticated;
