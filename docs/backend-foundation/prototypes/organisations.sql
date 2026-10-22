-- Organisations and programme affiliation. Affiliation ("this business takes
-- part in our programme") is separate from sponsorship (paid visibility, next
-- slice). Organisations never see identity documents, contact proofs or
-- verification evidence: applicants share a fixed, consented field set.
-- Staff manage organisations with organisation:manage (admin, recent MFA);
-- organisation administrators must hold a current verified identity.

create table private.organisations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  name text not null check(internal.plain_text_valid(name,2,160,false)),
  organisation_type text not null default 'other' check(organisation_type in('municipality','government_department',
    'led_programme','chamber_of_commerce','tourism_association','incubator','accelerator','enterprise_development','ngo',
    'supplier_development','mall','business_association','cooperative','professional_body','university_tvet','other')),
  logo_object_id uuid unique references private.media_objects(id) on delete restrict,
  logo_permission_at timestamptz,
  logo_permission_by uuid,
  logo_permission_reference text check(logo_permission_reference is null
    or internal.plain_text_valid(logo_permission_reference,3,200,false)),
  description text check(description is null or internal.plain_text_valid(description,1,2000,true)),
  programme_description text check(programme_description is null
    or internal.plain_text_valid(programme_description,1,2000,true)),
  service_area text check(service_area is null or internal.plain_text_valid(service_area,2,120,false)),
  province_id text references private.provinces(id),
  website text check(website is null or (char_length(website)<=300 and internal.plain_text_valid(website,12,300,false)
    and website ~ '^https://[a-z0-9-]+([.][a-z0-9-]+)+(/[^ ]*)?$')),
  public_email text check(public_email is null or internal.enquiry_email_valid(public_email)),
  public_phone text check(public_phone is null or public_phone ~ '^[+]27[0-9]{9}$'),
  programme_status text not null default 'invited' check(programme_status in
    ('invited','founding_trial','active_paid','affiliation_only','suspended','ended')),
  is_public boolean not null default false,
  programme_starts_at timestamptz,
  programme_ends_at timestamptz,
  affiliation_wording text not null default 'Programme Participant'
    check(internal.plain_text_valid(affiliation_wording,3,60,false)),
  sponsorship_wording text not null default 'Supported by'
    check(internal.plain_text_valid(sponsorship_wording,3,60,false)),
  sponsored_capacity integer not null default 50 check(sponsored_capacity between 0 and 100000),
  admin_limit integer not null default 3 check(admin_limit between 1 and 50),
  accepting_applications boolean not null default true,
  show_on_strip boolean not null default false,
  show_on_home boolean not null default false,
  display_order integer not null default 100 check(display_order between 0 and 100000),
  revision integer not null default 1 check(revision between 1 and 2147483647),
  created_by uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check(programme_ends_at is null or programme_starts_at is null or programme_ends_at>programme_starts_at),
  check((logo_permission_at is null)=(logo_permission_by is null)),
  check(logo_permission_at is null or logo_permission_reference is not null)
);
create index organisations_public_idx on private.organisations(display_order,name) where is_public;
alter table private.organisations enable row level security;
revoke all on private.organisations from public,anon,authenticated,service_role;

create table private.organisation_programmes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organisation_id uuid not null references private.organisations(id) on delete cascade,
  slug text not null check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  name text not null check(internal.plain_text_valid(name,2,160,false)),
  description text check(description is null or internal.plain_text_valid(description,1,2000,true)),
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  unique(organisation_id,slug),
  unique(id,organisation_id)
);
alter table private.organisation_programmes enable row level security;
revoke all on private.organisation_programmes from public,anon,authenticated,service_role;

create table private.organisation_admins (
  organisation_id uuid not null references private.organisations(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in('owner','admin')),
  added_by uuid,
  created_at timestamptz not null default statement_timestamp(),
  primary key(organisation_id,account_id)
);
create index organisation_admins_account_idx on private.organisation_admins(account_id);
alter table private.organisation_admins enable row level security;
revoke all on private.organisation_admins from public,anon,authenticated,service_role;

-- Only a SHA-256 hash of the emailed token is stored.
create table private.organisation_invites (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organisation_id uuid not null references private.organisations(id) on delete cascade,
  email text not null check(internal.enquiry_email_valid(email)),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  invited_by uuid not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz not null default statement_timestamp(),
  check((accepted_at is null)=(accepted_by is null)),
  check((revoked_at is null)=(revoked_by is null)),
  check(accepted_at is null or revoked_at is null)
);
create unique index organisation_invites_open_idx on private.organisation_invites(organisation_id,email)
  where accepted_at is null and revoked_at is null;
alter table private.organisation_invites enable row level security;
revoke all on private.organisation_invites from public,anon,authenticated,service_role;

create table private.organisation_applications (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organisation_id uuid not null references private.organisations(id) on delete cascade,
  programme_id uuid,
  post_id uuid not null,
  post_kind text not null default 'business' check(post_kind='business'),
  applicant_id uuid not null references auth.users(id) on delete cascade,
  reason text check(reason is null or internal.plain_text_valid(reason,2,1000,true)),
  member_reference text check(member_reference is null or internal.plain_text_valid(member_reference,1,120,false)),
  share_representative_name boolean not null,
  consented_at timestamptz not null,
  status text not null default 'submitted' check(status in('submitted','more_info_required','approved','declined','withdrawn')),
  info_request text check(info_request is null or internal.plain_text_valid(info_request,5,1000,true)),
  info_response text check(info_response is null or internal.plain_text_valid(info_response,2,2000,true)),
  decision_by uuid,
  decision_at timestamptz,
  decision_note text check(decision_note is null or internal.plain_text_valid(decision_note,1,1000,true)),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key(post_id,post_kind) references private.posts(id,kind) on delete cascade,
  foreign key(programme_id,organisation_id) references private.organisation_programmes(id,organisation_id)
);
create unique index organisation_applications_open_idx on private.organisation_applications(organisation_id,post_id)
  where status in('submitted','more_info_required');
create index organisation_applications_org_idx on private.organisation_applications(organisation_id,created_at desc,id desc);
create index organisation_applications_applicant_idx on private.organisation_applications(applicant_id,created_at);
create index organisation_applications_post_idx on private.organisation_applications(post_id);
alter table private.organisation_applications enable row level security;
revoke all on private.organisation_applications from public,anon,authenticated,service_role;

create table private.organisation_affiliations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organisation_id uuid not null references private.organisations(id) on delete cascade,
  programme_id uuid,
  post_id uuid not null,
  post_kind text not null default 'business' check(post_kind='business'),
  application_id uuid unique references private.organisation_applications(id) on delete set null,
  affiliation_type text not null default 'participant' check(affiliation_type in('participant','member','affiliate')),
  status text not null default 'active' check(status in('active','revoked','ended')),
  confirmed_at timestamptz not null default statement_timestamp(),
  confirmed_by uuid not null,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text check(revoke_reason is null or internal.plain_text_valid(revoke_reason,5,500,true)),
  created_at timestamptz not null default statement_timestamp(),
  foreign key(post_id,post_kind) references private.posts(id,kind) on delete cascade,
  foreign key(programme_id,organisation_id) references private.organisation_programmes(id,organisation_id),
  check((status='active')=(revoked_at is null))
);
create unique index organisation_affiliations_active_idx on private.organisation_affiliations(organisation_id,post_id)
  where status='active';
create index organisation_affiliations_post_idx on private.organisation_affiliations(post_id) where status='active';
create index organisation_affiliations_org_idx on private.organisation_affiliations(organisation_id,confirmed_at desc,id desc);
alter table private.organisation_affiliations enable row level security;
revoke all on private.organisation_affiliations from public,anon,authenticated,service_role;

create table private.organisation_notes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organisation_id uuid not null references private.organisations(id) on delete cascade,
  author_id uuid not null,
  note text not null check(internal.plain_text_valid(note,1,2000,true)),
  created_at timestamptz not null default statement_timestamp()
);
create index organisation_notes_org_idx on private.organisation_notes(organisation_id,created_at desc);
alter table private.organisation_notes enable row level security;
revoke all on private.organisation_notes from public,anon,authenticated,service_role;

-- Append-only record of who changed what, why.
create table private.organisation_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organisation_id uuid not null references private.organisations(id) on delete cascade,
  actor_id uuid not null,
  action text not null check(action ~ '^[a-z_]{3,60}$'),
  subject_id uuid,
  reason text check(reason is null or internal.plain_text_valid(reason,1,1000,true)),
  created_at timestamptz not null default statement_timestamp()
);
create index organisation_events_org_idx on private.organisation_events(organisation_id,created_at desc);
alter table private.organisation_events enable row level security;
revoke all on private.organisation_events from public,anon,authenticated,service_role;
create function internal.organisation_events_append_only()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception 'organisation events are append-only' using errcode='23514';
end;
$$;
revoke all on function internal.organisation_events_append_only() from public,anon,authenticated,service_role;
create trigger organisation_events_append_only before update on private.organisation_events
  for each row execute function internal.organisation_events_append_only();

insert into private.staff_capabilities(role,capability,requires_recent_mfa) values('admin','organisation:manage',true);

-- Organisation notifications reuse the owner inbox. Repeated decisions on one
-- application are separate notifications; enquiries stay one per enquiry.
alter table private.notifications add column organisation_id uuid references private.organisations(id) on delete cascade;
create index notifications_organisation_idx on private.notifications(organisation_id) where organisation_id is not null;
alter table private.notifications drop constraint notifications_kind_subject_id_key;
create unique index notifications_enquiry_once_idx on private.notifications(subject_id) where kind='enquiry_received';
alter table private.notifications drop constraint notifications_kind_check;
alter table private.notifications add constraint notifications_kind_check check(kind in('enquiry_received',
  'organisation_application_received','organisation_application_decided','organisation_affiliation_ended'));

create or replace function internal.notification_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.account_id,new.kind,new.subject_id,new.post_id,new.organisation_id,new.created_at)
      is distinct from (old.id,old.account_id,old.kind,old.subject_id,old.post_id,old.organisation_id,old.created_at)
    or (old.read_at is not null and new.read_at is distinct from old.read_at) then
    raise exception 'notifications are immutable except first read' using errcode='23514'; end if;
  return new;
end;
$$;

create or replace function internal.list_my_notifications(p_before_created timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); items jsonb; last private.notifications; unread integer;
begin
  perform internal.inbox_page_limit(p_limit,p_before_created,p_before_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'post_id',n.post_id,'post_title',p.title,
      'organisation_name',o.name,'created_at',n.created_at,'read_at',n.read_at) order by n.created_at desc,n.id desc),'[]')
    into items
  from (select * from private.notifications n where n.account_id=actor
      and (p_before_created is null or (n.created_at,n.id)<(p_before_created,p_before_id))
      order by n.created_at desc,n.id desc limit p_limit) n
  left join private.posts p on p.id=n.post_id
  left join private.organisations o on o.id=n.organisation_id;
  select n.* into last from private.notifications n where n.account_id=actor
    and (p_before_created is null or (n.created_at,n.id)<(p_before_created,p_before_id))
    order by n.created_at desc,n.id desc offset p_limit-1 limit 1;
  select count(*) into unread from private.notifications n where n.account_id=actor and n.read_at is null;
  return jsonb_build_object('items',items,'unread_count',unread,
    'next_cursor',case when last.id is not null and exists(select 1 from private.notifications y where y.account_id=actor
        and (y.created_at,y.id)<(last.created_at,last.id))
      then jsonb_build_object('before_created',last.created_at,'before_id',last.id) end);
end;
$$;

create function internal.notify_account(p_account uuid,p_kind text,p_subject uuid,p_post uuid,p_organisation uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  insert into private.notifications(account_id,kind,subject_id,post_id,organisation_id)
    values(p_account,p_kind,p_subject,p_post,p_organisation);
  perform internal.signal_owner_inbox(p_account);
end;
$$;
revoke all on function internal.notify_account(uuid,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- A programme is publicly listed only while public and in a live status.
create function internal.organisation_listed(o private.organisations)
returns boolean language sql immutable security invoker set search_path=pg_catalog as $$
  select o.is_public and o.programme_status in('founding_trial','active_paid','affiliation_only');
$$;
revoke all on function internal.organisation_listed(private.organisations) from public,anon,authenticated,service_role;

create function internal.affiliation_label(p_type text,p_wording text)
returns text language sql immutable security invoker set search_path=pg_catalog as $$
  select case p_type when 'member' then 'Member' when 'affiliate' then 'Affiliated with' else p_wording end;
$$;
revoke all on function internal.affiliation_label(text,text) from public,anon,authenticated,service_role;

create function internal.organisation_logo_key(o private.organisations)
returns text language sql stable security invoker set search_path=pg_catalog as $$
  select m.object_key from private.media_objects m
  where m.id=o.logo_object_id and o.logo_permission_at is not null and m.state='ready' and m.kind='image';
$$;
revoke all on function internal.organisation_logo_key(private.organisations) from public,anon,authenticated,service_role;

-- Masked address for invitation previews and admin lists ("s***@gmail.com").
create function internal.mask_email(p_email text)
returns text language sql immutable security invoker set search_path=pg_catalog as $$
  select left(p_email,1)||'***@'||split_part(p_email,'@',2);
$$;
revoke all on function internal.mask_email(text) from public,anon,authenticated,service_role;

create function internal.record_organisation_event(p_org uuid,p_actor uuid,p_action text,p_subject uuid,p_reason text)
returns void language sql security invoker set search_path=pg_catalog as $$
  insert into private.organisation_events(organisation_id,actor_id,action,subject_id,reason)
    values(p_org,p_actor,p_action,p_subject,p_reason);
$$;
revoke all on function internal.record_organisation_event(uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;

create function internal.organisation_reason(p_reason text)
returns void language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
  if not internal.plain_text_valid(p_reason,5,500,true) then
    raise exception 'a reason of 5 to 500 characters is required' using errcode='22023',detail='reason_required'; end if;
end;
$$;
revoke all on function internal.organisation_reason(text) from public,anon,authenticated,service_role;

-- Acting organisation administrator (verified identity) or, failing that,
-- staff with organisation:manage and recent MFA.
create function internal.organisation_actor(p_org uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();
begin
  if exists(select 1 from private.organisation_admins a where a.organisation_id=p_org and a.account_id=actor)
    and internal.current_verified_identity(actor) is not null then
    return actor;
  end if;
  return internal.staff_actor('organisation:manage');
end;
$$;
revoke all on function internal.organisation_actor(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.organisation_actor(uuid) to authenticated;

-- ── Public ────────────────────────────────────────────────────────────────

create function internal.public_organisation_directory()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  with live as (
    select f.organisation_id,count(distinct f.post_id)::integer n from private.organisation_affiliations f
    join private.public_eligible_posts e on e.id=f.post_id where f.status='active' group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('slug',o.slug,'name',o.name,'organisation_type',o.organisation_type,
      'service_area',o.service_area,'province',o.province_id,'logo_object_key',internal.organisation_logo_key(o),
      'programme_status',o.programme_status,'live_businesses',coalesce(l.n,0),
      'accepting_applications',o.accepting_applications,
      'on_strip',o.show_on_strip and internal.organisation_logo_key(o) is not null and coalesce(l.n,0)>=5,
      'on_home',o.show_on_home and internal.organisation_logo_key(o) is not null and coalesce(l.n,0)>=5)
    order by case o.programme_status when 'active_paid' then 0 when 'founding_trial' then 1 else 2 end,o.display_order,o.name),'[]')
  from (select * from private.organisations x where internal.organisation_listed(x)
    order by x.display_order,x.name limit 200) o
  left join live l on l.organisation_id=o.id;
$$;
revoke all on function internal.public_organisation_directory() from public,anon,authenticated,service_role;
grant execute on function internal.public_organisation_directory() to anon,authenticated;
create function api.public_organisation_directory()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.public_organisation_directory();
$$;
revoke all on function api.public_organisation_directory() from public,anon,authenticated,service_role;
grant execute on function api.public_organisation_directory() to anon,authenticated;

create function internal.get_public_organisation(p_slug text)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',o.id,'slug',o.slug,'name',o.name,'organisation_type',o.organisation_type,
    'description',o.description,'programme_description',o.programme_description,'service_area',o.service_area,
    'province',o.province_id,'website',o.website,'public_email',o.public_email,'public_phone',o.public_phone,
    'logo_object_key',internal.organisation_logo_key(o),'programme_status',o.programme_status,
    'accepting_applications',o.accepting_applications and o.programme_status not in('suspended','ended'),
    'affiliation_wording',o.affiliation_wording,
    'live_businesses',(select count(distinct f.post_id) from private.organisation_affiliations f
      join private.public_eligible_posts e on e.id=f.post_id where f.organisation_id=o.id and f.status='active'),
    'programmes',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'slug',p.slug,'name',p.name,
      'description',p.description) order by p.name) from private.organisation_programmes p
      where p.organisation_id=o.id and p.active),'[]'))
  from private.organisations o where o.slug=p_slug and internal.organisation_listed(o);
$$;
revoke all on function internal.get_public_organisation(text) from public,anon,authenticated,service_role;
grant execute on function internal.get_public_organisation(text) to anon,authenticated;
create function api.get_public_organisation(p_slug text)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.get_public_organisation(p_slug);
$$;
revoke all on function api.get_public_organisation(text) from public,anon,authenticated,service_role;
grant execute on function api.get_public_organisation(text) to anon,authenticated;

-- Badges for up to 100 public business posts; only live businesses of listed
-- organisations, logos only with recorded permission.
create function internal.public_post_affiliations(p_post_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if p_post_ids is null or cardinality(p_post_ids) not between 1 and 100 then
    raise exception 'between 1 and 100 post ids required' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('post_id',f.post_id,'organisation_slug',o.slug,
      'organisation_name',o.name,'logo_object_key',internal.organisation_logo_key(o),
      'label',internal.affiliation_label(f.affiliation_type,o.affiliation_wording),'programme_name',pr.name,
      'confirmed_at',f.confirmed_at) order by f.post_id,f.confirmed_at),'[]')
    from private.organisation_affiliations f
    join private.organisations o on o.id=f.organisation_id
    join private.public_eligible_posts e on e.id=f.post_id
    left join private.organisation_programmes pr on pr.id=f.programme_id
    where f.post_id=any(p_post_ids) and f.status='active' and internal.organisation_listed(o));
end;
$$;
revoke all on function internal.public_post_affiliations(uuid[]) from public,anon,authenticated,service_role;
grant execute on function internal.public_post_affiliations(uuid[]) to anon,authenticated;
create function api.public_post_affiliations(p_post_ids uuid[])
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.public_post_affiliations(p_post_ids);
$$;
revoke all on function api.public_post_affiliations(uuid[]) from public,anon,authenticated,service_role;
grant execute on function api.public_post_affiliations(uuid[]) to anon,authenticated;

-- ── Staff ─────────────────────────────────────────────────────────────────

create function internal.create_organisation(p_slug text,p_name text,p_type text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations;
begin
  perform internal.organisation_reason(p_reason);
  begin
    insert into private.organisations(slug,name,organisation_type,created_by) values(p_slug,p_name,p_type,actor)
      returning * into o;
  exception when check_violation or not_null_violation then
    raise exception 'organisation details are invalid' using errcode='22023',detail='organisation_invalid';
  when unique_violation then
    raise exception 'that address is already used' using errcode='PT409',detail='organisation_slug_taken';
  end;
  perform internal.record_organisation_event(o.id,actor,'organisation_created',o.id,p_reason);
  return jsonb_build_object('id',o.id,'slug',o.slug,'revision',o.revision);
end;
$$;
revoke all on function internal.create_organisation(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.create_organisation(text,text,text,text) to authenticated;
create function api.create_organisation(p_slug text,p_name text,p_type text,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.create_organisation(p_slug,p_name,p_type,p_reason);
$$;
revoke all on function api.create_organisation(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function api.create_organisation(text,text,text,text) to authenticated;

-- Whole-record revision fence; only allowlisted keys, each type-checked; the
-- table constraints then validate values.
create function internal.update_organisation(p_id uuid,p_expected_revision integer,p_patch jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations; k text; t text;
  text_keys text[]:=array['name','organisation_type','description','programme_description','service_area','province_id',
    'website','public_email','public_phone','programme_status','affiliation_wording','sponsorship_wording'];
  bool_keys text[]:=array['is_public','accepting_applications','show_on_strip','show_on_home'];
  int_keys text[]:=array['sponsored_capacity','admin_limit','display_order'];
  time_keys text[]:=array['programme_starts_at','programme_ends_at'];
begin
  perform internal.organisation_reason(p_reason);
  if p_expected_revision is null or p_expected_revision not between 1 and 2147483646
    or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb then
    raise exception 'organisation details are invalid' using errcode='22023',detail='organisation_invalid'; end if;
  for k,t in select key,jsonb_typeof(value) from jsonb_each(p_patch) loop
    if not((k=any(text_keys) and t in('string','null')) or (k=any(bool_keys) and t='boolean')
      or (k=any(int_keys) and t='number') or (k=any(time_keys) and t in('string','null'))) then
      raise exception 'organisation details are invalid' using errcode='22023',detail='organisation_invalid'; end if;
  end loop;
  select * into o from private.organisations where id=p_id for update;
  if not found then raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable'; end if;
  actor:=internal.staff_actor('organisation:manage');
  if o.revision<>p_expected_revision then
    raise exception 'organisation changed; reload it' using errcode='PT409',detail='organisation_changed'; end if;
  begin
    update private.organisations x set
      name=case when p_patch?'name' then p_patch->>'name' else x.name end,
      organisation_type=case when p_patch?'organisation_type' then p_patch->>'organisation_type' else x.organisation_type end,
      description=case when p_patch?'description' then p_patch->>'description' else x.description end,
      programme_description=case when p_patch?'programme_description' then p_patch->>'programme_description' else x.programme_description end,
      service_area=case when p_patch?'service_area' then p_patch->>'service_area' else x.service_area end,
      province_id=case when p_patch?'province_id' then p_patch->>'province_id' else x.province_id end,
      website=case when p_patch?'website' then p_patch->>'website' else x.website end,
      public_email=case when p_patch?'public_email' then p_patch->>'public_email' else x.public_email end,
      public_phone=case when p_patch?'public_phone' then p_patch->>'public_phone' else x.public_phone end,
      programme_status=case when p_patch?'programme_status' then p_patch->>'programme_status' else x.programme_status end,
      affiliation_wording=case when p_patch?'affiliation_wording' then p_patch->>'affiliation_wording' else x.affiliation_wording end,
      sponsorship_wording=case when p_patch?'sponsorship_wording' then p_patch->>'sponsorship_wording' else x.sponsorship_wording end,
      is_public=case when p_patch?'is_public' then (p_patch->>'is_public')::boolean else x.is_public end,
      accepting_applications=case when p_patch?'accepting_applications' then (p_patch->>'accepting_applications')::boolean else x.accepting_applications end,
      show_on_strip=case when p_patch?'show_on_strip' then (p_patch->>'show_on_strip')::boolean else x.show_on_strip end,
      show_on_home=case when p_patch?'show_on_home' then (p_patch->>'show_on_home')::boolean else x.show_on_home end,
      sponsored_capacity=case when p_patch?'sponsored_capacity' then (p_patch->>'sponsored_capacity')::integer else x.sponsored_capacity end,
      admin_limit=case when p_patch?'admin_limit' then (p_patch->>'admin_limit')::integer else x.admin_limit end,
      display_order=case when p_patch?'display_order' then (p_patch->>'display_order')::integer else x.display_order end,
      programme_starts_at=case when p_patch?'programme_starts_at' then (p_patch->>'programme_starts_at')::timestamptz else x.programme_starts_at end,
      programme_ends_at=case when p_patch?'programme_ends_at' then (p_patch->>'programme_ends_at')::timestamptz else x.programme_ends_at end,
      revision=x.revision+1,updated_at=statement_timestamp()
    where x.id=o.id returning * into o;
  exception when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
    or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception 'organisation details are invalid' using errcode='22023',detail='organisation_invalid';
  end;
  perform internal.record_organisation_event(o.id,actor,'organisation_updated',o.id,p_reason);
  return jsonb_build_object('id',o.id,'slug',o.slug,'revision',o.revision);
end;
$$;
revoke all on function internal.update_organisation(uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function internal.update_organisation(uuid,integer,jsonb,text) to authenticated;
create function api.update_organisation(p_id uuid,p_expected_revision integer,p_patch jsonb,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.update_organisation(p_id,p_expected_revision,p_patch,p_reason);
$$;
revoke all on function api.update_organisation(uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function api.update_organisation(uuid,integer,jsonb,text) to authenticated;

-- Logo: the acting staff member's own ready image plus the written
-- permission reference; without permission no logo is ever shown.
create function internal.set_organisation_logo(p_id uuid,p_expected_revision integer,p_object_id uuid,
  p_permission_reference text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations;
begin
  perform internal.organisation_reason(p_reason);
  if (p_object_id is null)<>(p_permission_reference is null)
    or (p_permission_reference is not null and not internal.plain_text_valid(p_permission_reference,3,200,false)) then
    raise exception 'logo and written permission go together' using errcode='22023',detail='organisation_invalid'; end if;
  select * into o from private.organisations where id=p_id for update;
  if not found then raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable'; end if;
  if p_object_id is not null then
    perform 1 from private.media_objects m where m.id=p_object_id and m.owner_id=actor and m.kind='image'
      and m.state='ready' for update;
    if not found then raise exception 'your own ready image is required' using errcode='22023',detail='logo_unavailable'; end if;
  end if;
  actor:=internal.staff_actor('organisation:manage');
  if o.revision<>p_expected_revision then
    raise exception 'organisation changed; reload it' using errcode='PT409',detail='organisation_changed'; end if;
  if o.logo_object_id is not null and o.logo_object_id is distinct from p_object_id then
    update private.media_objects set unlinked_at=statement_timestamp() where id=o.logo_object_id; end if;
  update private.organisations set logo_object_id=p_object_id,
    logo_permission_at=case when p_object_id is null then null else statement_timestamp() end,
    logo_permission_by=case when p_object_id is null then null else actor end,
    logo_permission_reference=p_permission_reference,revision=revision+1,updated_at=statement_timestamp()
  where id=o.id returning * into o;
  perform internal.record_organisation_event(o.id,actor,'organisation_logo_set',p_object_id,p_reason);
  return jsonb_build_object('id',o.id,'slug',o.slug,'revision',o.revision);
end;
$$;
revoke all on function internal.set_organisation_logo(uuid,integer,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.set_organisation_logo(uuid,integer,uuid,text,text) to authenticated;
create function api.set_organisation_logo(p_id uuid,p_expected_revision integer,p_reason text,
  p_object_id uuid default null,p_permission_reference text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.set_organisation_logo(p_id,p_expected_revision,p_object_id,p_permission_reference,p_reason);
$$;
revoke all on function api.set_organisation_logo(uuid,integer,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.set_organisation_logo(uuid,integer,text,uuid,text) to authenticated;

create function internal.save_organisation_programme(p_org uuid,p_slug text,p_name text,p_description text,
  p_active boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage'); pr private.organisation_programmes;
begin
  perform internal.organisation_reason(p_reason);
  perform 1 from private.organisations where id=p_org for update;
  if not found then raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable'; end if;
  begin
    insert into private.organisation_programmes(organisation_id,slug,name,description,active)
      values(p_org,p_slug,p_name,p_description,coalesce(p_active,true))
    on conflict(organisation_id,slug) do update set name=excluded.name,description=excluded.description,
      active=excluded.active
    returning * into pr;
  exception when check_violation or not_null_violation then
    raise exception 'programme details are invalid' using errcode='22023',detail='organisation_invalid';
  end;
  perform internal.record_organisation_event(p_org,actor,'programme_saved',pr.id,p_reason);
  return jsonb_build_object('id',pr.id,'slug',pr.slug,'active',pr.active);
end;
$$;
revoke all on function internal.save_organisation_programme(uuid,text,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function internal.save_organisation_programme(uuid,text,text,text,boolean,text) to authenticated;
create function api.save_organisation_programme(p_org uuid,p_slug text,p_name text,p_reason text,
  p_description text default null,p_active boolean default true)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_organisation_programme(p_org,p_slug,p_name,p_description,p_active,p_reason);
$$;
revoke all on function api.save_organisation_programme(uuid,text,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function api.save_organisation_programme(uuid,text,text,text,text,boolean) to authenticated;

-- The website generates and emails the token; only its hash arrives here.
-- Re-inviting an address replaces its open invitation.
create function internal.invite_organisation_admin(p_org uuid,p_email text,p_token_hash text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations; inv private.organisation_invites;
begin
  perform internal.organisation_reason(p_reason);
  if not internal.enquiry_email_valid(p_email) or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invitation details are invalid' using errcode='22023',detail='invite_invalid'; end if;
  select * into o from private.organisations where id=p_org for update;
  if not found then raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable'; end if;
  actor:=internal.staff_actor('organisation:manage');
  if o.programme_status in('suspended','ended') then
    raise exception 'this programme is not active' using errcode='PT409',detail='organisation_inactive'; end if;
  if exists(select 1 from private.organisation_admins a join auth.users u on u.id=a.account_id
      where a.organisation_id=o.id and lower(u.email)=p_email) then
    raise exception 'already an administrator' using errcode='PT409',detail='admin_exists'; end if;
  update private.organisation_invites set revoked_at=statement_timestamp(),revoked_by=actor
    where organisation_id=o.id and email=p_email and accepted_at is null and revoked_at is null;
  if (select count(*) from private.organisation_admins where organisation_id=o.id)
    +(select count(*) from private.organisation_invites where organisation_id=o.id and accepted_at is null
        and revoked_at is null and expires_at>statement_timestamp())>=o.admin_limit then
    raise exception 'administrator limit reached' using errcode='PT409',detail='admin_limit'; end if;
  begin
    insert into private.organisation_invites(organisation_id,email,token_hash,invited_by,expires_at)
      values(o.id,p_email,p_token_hash,actor,statement_timestamp()+interval '7 days') returning * into inv;
  exception when unique_violation then
    raise exception 'invitation details are invalid' using errcode='22023',detail='invite_invalid';
  end;
  perform internal.record_organisation_event(o.id,actor,'admin_invited',inv.id,p_reason);
  return jsonb_build_object('invite_id',inv.id,'expires_at',inv.expires_at,'organisation_name',o.name);
end;
$$;
revoke all on function internal.invite_organisation_admin(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.invite_organisation_admin(uuid,text,text,text) to authenticated;
create function api.invite_organisation_admin(p_org uuid,p_email text,p_token_hash text,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.invite_organisation_admin(p_org,p_email,p_token_hash,p_reason);
$$;
revoke all on function api.invite_organisation_admin(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function api.invite_organisation_admin(uuid,text,text,text) to authenticated;

create function internal.revoke_organisation_invite(p_invite uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage'); inv private.organisation_invites;
begin
  perform internal.organisation_reason(p_reason);
  update private.organisation_invites set revoked_at=statement_timestamp(),revoked_by=actor
    where id=p_invite and accepted_at is null and revoked_at is null returning * into inv;
  if inv.id is null then raise exception 'open invitation not found' using errcode='PT404',detail='invite_unavailable'; end if;
  perform internal.record_organisation_event(inv.organisation_id,actor,'admin_invite_revoked',inv.id,p_reason);
  return jsonb_build_object('invite_id',inv.id,'revoked',true);
end;
$$;
revoke all on function internal.revoke_organisation_invite(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.revoke_organisation_invite(uuid,text) to authenticated;
create function api.revoke_organisation_invite(p_invite uuid,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.revoke_organisation_invite(p_invite,p_reason);
$$;
revoke all on function api.revoke_organisation_invite(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.revoke_organisation_invite(uuid,text) to authenticated;

create function internal.remove_organisation_admin(p_org uuid,p_account uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage');
begin
  perform internal.organisation_reason(p_reason);
  delete from private.organisation_admins where organisation_id=p_org and account_id=p_account;
  if not found then raise exception 'administrator not found' using errcode='PT404',detail='admin_unavailable'; end if;
  perform internal.record_organisation_event(p_org,actor,'admin_removed',p_account,p_reason);
  return jsonb_build_object('removed',true);
end;
$$;
revoke all on function internal.remove_organisation_admin(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.remove_organisation_admin(uuid,uuid,text) to authenticated;
create function api.remove_organisation_admin(p_org uuid,p_account uuid,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.remove_organisation_admin(p_org,p_account,p_reason);
$$;
revoke all on function api.remove_organisation_admin(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.remove_organisation_admin(uuid,uuid,text) to authenticated;

create function internal.add_organisation_note(p_org uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage'); n private.organisation_notes;
begin
  begin
    insert into private.organisation_notes(organisation_id,author_id,note) values(p_org,actor,p_note) returning * into n;
  exception when check_violation or not_null_violation then
    raise exception 'note is invalid' using errcode='22023',detail='organisation_invalid';
  when foreign_key_violation then
    raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable';
  end;
  return jsonb_build_object('id',n.id,'created_at',n.created_at);
end;
$$;
revoke all on function internal.add_organisation_note(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.add_organisation_note(uuid,text) to authenticated;
create function api.add_organisation_note(p_org uuid,p_note text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.add_organisation_note(p_org,p_note);
$$;
revoke all on function api.add_organisation_note(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.add_organisation_note(uuid,text) to authenticated;

-- Staff back-office view: everything except invitation tokens and full
-- invitee addresses.
create function internal.staff_get_organisation(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations;
begin
  select * into o from private.organisations where id=p_id;
  if not found then return null; end if;
  return to_jsonb(o)-'created_by'-'logo_permission_by'||jsonb_build_object(
    'logo_object_key',(select m.object_key from private.media_objects m where m.id=o.logo_object_id),
    'admins',coalesce((select jsonb_agg(jsonb_build_object('account_id',a.account_id,'role',a.role,
      'display_name',p.display_name,'created_at',a.created_at) order by a.created_at)
      from private.organisation_admins a left join private.profiles p on p.account_id=a.account_id
      where a.organisation_id=o.id),'[]'),
    'open_invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',internal.mask_email(i.email),
      'expires_at',i.expires_at) order by i.created_at) from private.organisation_invites i
      where i.organisation_id=o.id and i.accepted_at is null and i.revoked_at is null
        and i.expires_at>statement_timestamp()),'[]'),
    'programmes',coalesce((select jsonb_agg(jsonb_build_object('id',pr.id,'slug',pr.slug,'name',pr.name,
      'active',pr.active) order by pr.name) from private.organisation_programmes pr where pr.organisation_id=o.id),'[]'),
    'active_affiliations',(select count(*) from private.organisation_affiliations f
      where f.organisation_id=o.id and f.status='active'),
    'open_applications',(select count(*) from private.organisation_applications a
      where a.organisation_id=o.id and a.status in('submitted','more_info_required')),
    'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'created_at',n.created_at)
      order by n.created_at desc) from (select * from private.organisation_notes n where n.organisation_id=o.id
      order by n.created_at desc limit 50) n),'[]'));
end;
$$;
revoke all on function internal.staff_get_organisation(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.staff_get_organisation(uuid) to authenticated;
create function api.staff_get_organisation(p_id uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.staff_get_organisation(p_id);
$$;
revoke all on function api.staff_get_organisation(uuid) from public,anon,authenticated,service_role;
grant execute on function api.staff_get_organisation(uuid) to authenticated;

create function internal.staff_list_organisations()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('organisation:manage');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'slug',o.slug,'name',o.name,
      'programme_status',o.programme_status,'is_public',o.is_public,'revision',o.revision,'updated_at',o.updated_at)
    order by o.name),'[]') from (select * from private.organisations order by name limit 500) o);
end;
$$;
revoke all on function internal.staff_list_organisations() from public,anon,authenticated,service_role;
grant execute on function internal.staff_list_organisations() to authenticated;
create function api.staff_list_organisations()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.staff_list_organisations();
$$;
revoke all on function api.staff_list_organisations() from public,anon,authenticated,service_role;
grant execute on function api.staff_list_organisations() to authenticated;

-- ── Invitation recipient ──────────────────────────────────────────────────

create function internal.preview_organisation_invite(p_token_hash text)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('organisation_name',o.name,'email',internal.mask_email(i.email),'expires_at',i.expires_at,
    'status',case when i.accepted_at is not null then 'used' when i.revoked_at is not null then 'revoked'
      when i.expires_at<=statement_timestamp() then 'expired'
      when o.programme_status in('suspended','ended') then 'inactive' else 'open' end)
  from private.organisation_invites i join private.organisations o on o.id=i.organisation_id
  where p_token_hash ~ '^[a-f0-9]{64}$' and i.token_hash=p_token_hash;
$$;
revoke all on function internal.preview_organisation_invite(text) from public,anon,authenticated,service_role;
grant execute on function internal.preview_organisation_invite(text) to anon,authenticated;
create function api.preview_organisation_invite(p_token_hash text)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.preview_organisation_invite(p_token_hash);
$$;
revoke all on function api.preview_organisation_invite(text) from public,anon,authenticated,service_role;
grant execute on function api.preview_organisation_invite(text) to anon,authenticated;

-- The signed-in recipient must own the invited address and hold a current
-- verified identity. The first administrator becomes the owner.
create function internal.accept_organisation_invite(p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); inv private.organisation_invites; o private.organisations; n integer; r text;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'this invitation link is no longer valid' using errcode='PT409',detail='invite_invalid'; end if;
  select * into inv from private.organisation_invites where token_hash=p_token_hash;
  if not found then
    raise exception 'this invitation link is no longer valid' using errcode='PT409',detail='invite_invalid'; end if;
  select * into o from private.organisations where id=inv.organisation_id for update;
  select * into inv from private.organisation_invites where id=inv.id for update;
  actor:=internal.price_draft_actor();
  if inv.revoked_at is not null or inv.accepted_at is not null or inv.expires_at<=statement_timestamp() then
    raise exception 'this invitation link is no longer valid' using errcode='PT409',detail='invite_invalid'; end if;
  if not exists(select 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null and lower(u.email)=inv.email) then
    raise exception 'sign in with the invited email address' using errcode='42501',detail='invite_email_mismatch'; end if;
  if internal.current_verified_identity(actor) is null then
    raise exception 'complete identity verification first' using errcode='42501',detail='verification_required'; end if;
  if o.programme_status in('suspended','ended') then
    raise exception 'this programme is not active' using errcode='PT409',detail='organisation_inactive'; end if;
  if not exists(select 1 from private.organisation_admins where organisation_id=o.id and account_id=actor) then
    select count(*) into n from private.organisation_admins where organisation_id=o.id;
    if n>=o.admin_limit then raise exception 'administrator limit reached' using errcode='PT409',detail='admin_limit'; end if;
    r:=case when n=0 then 'owner' else 'admin' end;
    insert into private.organisation_admins(organisation_id,account_id,role,added_by) values(o.id,actor,r,inv.invited_by);
  end if;
  update private.organisation_invites set accepted_at=statement_timestamp(),accepted_by=actor where id=inv.id;
  perform internal.record_organisation_event(o.id,actor,'admin_invite_accepted',inv.id,null);
  return jsonb_build_object('organisation_slug',o.slug,
    'role',(select a.role from private.organisation_admins a where a.organisation_id=o.id and a.account_id=actor));
end;
$$;
revoke all on function internal.accept_organisation_invite(text) from public,anon,authenticated,service_role;
grant execute on function internal.accept_organisation_invite(text) to authenticated;
create function api.accept_organisation_invite(p_token_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.accept_organisation_invite(p_token_hash);
$$;
revoke all on function api.accept_organisation_invite(text) from public,anon,authenticated,service_role;
grant execute on function api.accept_organisation_invite(text) to authenticated;

-- ── Business owner ────────────────────────────────────────────────────────

create function internal.apply_to_organisation(p_org uuid,p_programme uuid,p_post_id uuid,p_reason text,
  p_member_reference text,p_share_representative_name boolean,p_consent boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); o private.organisations; post private.posts;
  app private.organisation_applications;
begin
  if p_consent is distinct from true or p_share_representative_name is null then
    raise exception 'consent to share the listed details is required' using errcode='22023',detail='consent_required'; end if;
  select * into post from private.posts where id=p_post_id and owner_id=actor and kind='business' and edit_of is null
    and status not in('archived') for share;
  if not found then
    raise exception 'choose one of your business profiles' using errcode='PT404',detail='business_unavailable'; end if;
  select * into o from private.organisations where id=p_org for share;
  if not found or not internal.organisation_listed(o) or not o.accepting_applications then
    raise exception 'this organisation is not accepting requests' using errcode='PT409',detail='applications_closed'; end if;
  actor:=internal.price_draft_actor();
  if p_programme is not null and not exists(select 1 from private.organisation_programmes pr
      where pr.id=p_programme and pr.organisation_id=o.id and pr.active) then
    raise exception 'programme not found' using errcode='PT404',detail='programme_unavailable'; end if;
  if exists(select 1 from private.organisation_affiliations f where f.organisation_id=o.id and f.post_id=post.id
      and f.status='active') then
    raise exception 'this business is already affiliated' using errcode='PT409',detail='already_affiliated'; end if;
  if (select count(*) from private.organisation_applications a where a.applicant_id=actor
      and a.created_at>statement_timestamp()-interval '1 day')>=10 then
    raise exception 'too many requests today' using errcode='PT429',detail='application_limit'; end if;
  begin
    insert into private.organisation_applications(organisation_id,programme_id,post_id,applicant_id,reason,
      member_reference,share_representative_name,consented_at)
    values(o.id,p_programme,post.id,actor,p_reason,p_member_reference,p_share_representative_name,statement_timestamp())
    returning * into app;
  exception when unique_violation then
    raise exception 'a request for this organisation is already open' using errcode='PT409',detail='application_open';
  when check_violation then
    raise exception 'request details are invalid' using errcode='22023',detail='application_invalid';
  end;
  perform internal.notify_account(a.account_id,'organisation_application_received',app.id,post.id,o.id)
    from private.organisation_admins a where a.organisation_id=o.id;
  return jsonb_build_object('id',app.id,'status',app.status);
end;
$$;
revoke all on function internal.apply_to_organisation(uuid,uuid,uuid,text,text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.apply_to_organisation(uuid,uuid,uuid,text,text,boolean,boolean) to authenticated;
create function api.apply_to_organisation(p_org uuid,p_post_id uuid,p_share_representative_name boolean,
  p_consent boolean,p_programme uuid default null,p_reason text default null,p_member_reference text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.apply_to_organisation(p_org,p_programme,p_post_id,p_reason,p_member_reference,
    p_share_representative_name,p_consent);
$$;
revoke all on function api.apply_to_organisation(uuid,uuid,boolean,boolean,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function api.apply_to_organisation(uuid,uuid,boolean,boolean,uuid,text,text) to authenticated;

-- Applicant follow-up: answer an information request, or withdraw.
create function internal.update_my_application(p_application uuid,p_action text,p_response text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); a private.organisation_applications;
begin
  select * into a from private.organisation_applications where id=p_application and applicant_id=actor for update;
  if not found then return null; end if;
  if p_action='respond' then
    if a.status<>'more_info_required' then
      raise exception 'no information was requested' using errcode='PT409',detail='application_state'; end if;
    if p_response is null or not internal.plain_text_valid(p_response,2,2000,true) then
      raise exception 'a response is required' using errcode='22023',detail='application_invalid'; end if;
    update private.organisation_applications set status='submitted',info_response=p_response,updated_at=statement_timestamp()
      where id=a.id returning * into a;
    perform internal.notify_account(x.account_id,'organisation_application_received',a.id,a.post_id,a.organisation_id)
      from private.organisation_admins x where x.organisation_id=a.organisation_id;
  elsif p_action='withdraw' then
    if a.status not in('submitted','more_info_required') then
      raise exception 'only open requests can be withdrawn' using errcode='PT409',detail='application_state'; end if;
    update private.organisation_applications set status='withdrawn',updated_at=statement_timestamp()
      where id=a.id returning * into a;
  else
    raise exception 'unknown action' using errcode='22023',detail='application_invalid';
  end if;
  return jsonb_build_object('id',a.id,'status',a.status);
end;
$$;
revoke all on function internal.update_my_application(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.update_my_application(uuid,text,text) to authenticated;
create function api.update_my_application(p_application uuid,p_action text,p_response text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.update_my_application(p_application,p_action,p_response);
$$;
revoke all on function api.update_my_application(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function api.update_my_application(uuid,text,text) to authenticated;

create function internal.my_organisation_links()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();
begin
  return jsonb_build_object(
    'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'organisation_name',o.name,
        'organisation_slug',o.slug,'post_id',a.post_id,'post_title',p.title,'status',a.status,
        'info_request',a.info_request,'created_at',a.created_at,'updated_at',a.updated_at) order by a.created_at desc)
      from (select * from private.organisation_applications x where x.applicant_id=actor
        order by x.created_at desc limit 100) a
      join private.organisations o on o.id=a.organisation_id join private.posts p on p.id=a.post_id),'[]'),
    'affiliations',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'organisation_name',o.name,
        'organisation_slug',o.slug,'post_id',f.post_id,'post_title',p.title,
        'label',internal.affiliation_label(f.affiliation_type,o.affiliation_wording),'confirmed_at',f.confirmed_at)
        order by f.confirmed_at desc)
      from private.organisation_affiliations f join private.posts p on p.id=f.post_id
      join private.organisations o on o.id=f.organisation_id
      where p.owner_id=actor and f.status='active'),'[]'),
    'administers',coalesce((select jsonb_agg(jsonb_build_object('organisation_id',o.id,'organisation_name',o.name,
        'organisation_slug',o.slug,'role',x.role) order by o.name)
      from private.organisation_admins x join private.organisations o on o.id=x.organisation_id
      where x.account_id=actor),'[]'));
end;
$$;
revoke all on function internal.my_organisation_links() from public,anon,authenticated,service_role;
grant execute on function internal.my_organisation_links() to authenticated;
create function api.my_organisation_links()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.my_organisation_links();
$$;
revoke all on function api.my_organisation_links() from public,anon,authenticated,service_role;
grant execute on function api.my_organisation_links() to authenticated;

-- ── Organisation administrator ────────────────────────────────────────────

-- Deliberately minimal: business title, category and place, whether the
-- applicant's identity check is complete, and the representative's reviewed
-- name only when the applicant agreed to share it.
create function internal.org_list_applications(p_org uuid,p_status text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.organisation_actor(p_org);
begin
  if p_status is not null and p_status not in('submitted','more_info_required','approved','declined','withdrawn') then
    raise exception 'invalid status' using errcode='22023',detail='application_invalid'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'status',a.status,'post_id',a.post_id,
      'business_name',p.title,'category',p.category_key,'province',p.province_id,'city',p.city_id,
      'identity_verified',internal.current_verified_identity(a.applicant_id) is not null,
      'representative_name',case when a.share_representative_name and pr.legal_name_locked_at is not null
        then pr.legal_first_name||' '||pr.legal_last_name end,
      'programme_name',g.name,'reason',a.reason,'member_reference',a.member_reference,
      'info_request',a.info_request,'info_response',a.info_response,'submitted_at',a.created_at,
      'decision_at',a.decision_at,'decision_note',a.decision_note) order by a.created_at desc),'[]')
    from (select * from private.organisation_applications x where x.organisation_id=p_org
      and (p_status is null or x.status=p_status) order by x.created_at desc limit 200) a
    join private.posts p on p.id=a.post_id
    left join private.profiles pr on pr.account_id=a.applicant_id
    left join private.organisation_programmes g on g.id=a.programme_id);
end;
$$;
revoke all on function internal.org_list_applications(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.org_list_applications(uuid,text) to authenticated;
create function api.org_list_applications(p_org uuid,p_status text default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.org_list_applications(p_org,p_status);
$$;
revoke all on function api.org_list_applications(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.org_list_applications(uuid,text) to authenticated;

create function internal.org_decide_application(p_application uuid,p_decision text,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; a private.organisation_applications; o private.organisations; owner uuid; aff uuid;
begin
  select * into a from private.organisation_applications where id=p_application;
  if not found then raise exception 'request not found' using errcode='PT404',detail='application_unavailable'; end if;
  actor:=internal.organisation_actor(a.organisation_id);
  select * into o from private.organisations where id=a.organisation_id for share;
  select * into a from private.organisation_applications where id=a.id for update;
  actor:=internal.organisation_actor(a.organisation_id);
  if a.status not in('submitted','more_info_required') then
    raise exception 'request already decided' using errcode='PT409',detail='application_state'; end if;
  if o.programme_status in('suspended','ended') then
    raise exception 'this programme is not active' using errcode='PT409',detail='organisation_inactive'; end if;
  if p_note is not null and not internal.plain_text_valid(p_note,1,1000,true) then
    raise exception 'note is invalid' using errcode='22023',detail='application_invalid'; end if;
  select p.owner_id into owner from private.posts p where p.id=a.post_id;
  if p_decision='approve' then
    update private.organisation_applications set status='approved',decision_by=actor,decision_at=statement_timestamp(),
      decision_note=p_note,updated_at=statement_timestamp() where id=a.id;
    insert into private.organisation_affiliations(organisation_id,programme_id,post_id,application_id,confirmed_by)
      values(a.organisation_id,a.programme_id,a.post_id,a.id,actor)
      on conflict(organisation_id,post_id) where status='active' do nothing returning id into aff;
  elsif p_decision='decline' then
    update private.organisation_applications set status='declined',decision_by=actor,decision_at=statement_timestamp(),
      decision_note=p_note,updated_at=statement_timestamp() where id=a.id;
  elsif p_decision='request_info' then
    if p_note is null or not internal.plain_text_valid(p_note,5,1000,true) then
      raise exception 'describe the information required' using errcode='22023',detail='application_invalid'; end if;
    update private.organisation_applications set status='more_info_required',info_request=p_note,
      updated_at=statement_timestamp() where id=a.id;
  else
    raise exception 'unknown decision' using errcode='22023',detail='application_invalid';
  end if;
  perform internal.notify_account(owner,'organisation_application_decided',a.id,a.post_id,a.organisation_id);
  perform internal.record_organisation_event(a.organisation_id,actor,'application_'||p_decision,a.id,p_note);
  return jsonb_build_object('id',a.id,'decision',p_decision,'affiliation_id',aff);
end;
$$;
revoke all on function internal.org_decide_application(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.org_decide_application(uuid,text,text) to authenticated;
create function api.org_decide_application(p_application uuid,p_decision text,p_note text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.org_decide_application(p_application,p_decision,p_note);
$$;
revoke all on function api.org_decide_application(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function api.org_decide_application(uuid,text,text) to authenticated;

create function internal.org_list_affiliations(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.organisation_actor(p_org);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'post_id',f.post_id,'business_name',p.title,
      'category',p.category_key,'province',p.province_id,'city',p.city_id,
      'live',exists(select 1 from private.public_eligible_posts e where e.id=f.post_id),
      'affiliation_type',f.affiliation_type,'programme_name',g.name,'confirmed_at',f.confirmed_at)
      order by f.confirmed_at desc),'[]')
    from (select * from private.organisation_affiliations x where x.organisation_id=p_org and x.status='active'
      order by x.confirmed_at desc limit 500) f
    join private.posts p on p.id=f.post_id
    left join private.organisation_programmes g on g.id=f.programme_id);
end;
$$;
revoke all on function internal.org_list_affiliations(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.org_list_affiliations(uuid) to authenticated;
create function api.org_list_affiliations(p_org uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.org_list_affiliations(p_org);
$$;
revoke all on function api.org_list_affiliations(uuid) from public,anon,authenticated,service_role;
grant execute on function api.org_list_affiliations(uuid) to authenticated;

-- Revoke an affiliation or change its type ('participant'/'member'/'affiliate').
create function internal.org_update_affiliation(p_affiliation uuid,p_action text,p_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid; f private.organisation_affiliations; owner uuid;
begin
  select * into f from private.organisation_affiliations where id=p_affiliation;
  if not found then raise exception 'affiliation not found' using errcode='PT404',detail='affiliation_unavailable'; end if;
  actor:=internal.organisation_actor(f.organisation_id);
  select * into f from private.organisation_affiliations where id=f.id for update;
  actor:=internal.organisation_actor(f.organisation_id);
  if f.status<>'active' then
    raise exception 'affiliation is not active' using errcode='PT409',detail='affiliation_state'; end if;
  if p_action='revoke' then
    perform internal.organisation_reason(p_value);
    update private.organisation_affiliations set status='revoked',revoked_at=statement_timestamp(),revoked_by=actor,
      revoke_reason=p_value where id=f.id returning * into f;
    select p.owner_id into owner from private.posts p where p.id=f.post_id;
    perform internal.notify_account(owner,'organisation_affiliation_ended',f.id,f.post_id,f.organisation_id);
  elsif p_action='set_type' then
    if p_value is null or p_value not in('participant','member','affiliate') then
      raise exception 'unknown affiliation type' using errcode='22023',detail='affiliation_invalid'; end if;
    update private.organisation_affiliations set affiliation_type=p_value where id=f.id returning * into f;
  else
    raise exception 'unknown action' using errcode='22023',detail='affiliation_invalid';
  end if;
  perform internal.record_organisation_event(f.organisation_id,actor,'affiliation_'||p_action,f.id,
    case when p_action='revoke' then p_value end);
  return jsonb_build_object('id',f.id,'status',f.status,'affiliation_type',f.affiliation_type);
end;
$$;
revoke all on function internal.org_update_affiliation(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.org_update_affiliation(uuid,text,text) to authenticated;
create function api.org_update_affiliation(p_affiliation uuid,p_action text,p_value text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.org_update_affiliation(p_affiliation,p_action,p_value);
$$;
revoke all on function api.org_update_affiliation(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function api.org_update_affiliation(uuid,text,text) to authenticated;
