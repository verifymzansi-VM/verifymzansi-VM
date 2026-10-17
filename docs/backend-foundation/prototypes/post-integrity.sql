-- BF-05 disposable identity/cardinality candidate. Not the final post baseline.
create table private.post_category_contracts (
  category_key text not null, kind text not null, area text not null,
  primary key (category_key,kind,area)
);
insert into private.post_category_contracts values
  ('fixture_market','listing','market'),
  ('fixture_business','business','business'),
  ('fixture_tourism_business','business','tourism_events'),
  ('fixture_event','event','tourism_events');
alter table private.post_category_contracts enable row level security;
revoke all on private.post_category_contracts from public, anon, authenticated, service_role;

create table private.posts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('listing','business','event')),
  area text not null check (area in ('market','business','tourism_events')),
  category_key text not null,
  status text not null default 'draft' check (status in ('draft','pending_moderation','live','paused','rejected','expired','sold','archived')),
  revision integer not null default 1 check (revision>0),
  created_at timestamptz not null default statement_timestamp(),
  content_updated_at timestamptz not null default statement_timestamp(),
  unique(id,kind),
  foreign key (category_key,kind,area) references private.post_category_contracts(category_key,kind,area),
  check ((kind='listing' and area='market') or (kind='business' and area in ('business','tourism_events')) or (kind='event' and area='tourism_events')),
  check (status<>'sold' or kind='listing')
);
create index posts_owner_draft_idx on private.posts(owner_id,status);
alter table private.posts enable row level security;
revoke all on private.posts from public, anon, authenticated, service_role;

create table private.listing_details (
  post_id uuid primary key, post_kind text not null default 'listing' check (post_kind='listing'),
  foreign key(post_id,post_kind) references private.posts(id,kind) on delete cascade
);
create table private.business_details (
  post_id uuid primary key, post_kind text not null default 'business' check (post_kind='business'),
  foreign key(post_id,post_kind) references private.posts(id,kind) on delete cascade
);
create table private.event_details (
  post_id uuid primary key, post_kind text not null default 'event' check (post_kind='event'),
  starts_at timestamptz not null, ends_at timestamptz not null, timezone text not null,
  foreign key(post_id,post_kind) references private.posts(id,kind) on delete cascade,
  check (starts_at=date_trunc('milliseconds',starts_at) and ends_at=date_trunc('milliseconds',ends_at)),
  check (ends_at>starts_at and ends_at-starts_at<=interval '90 days')
);
create table private.post_event_timezones(name text primary key);
insert into private.post_event_timezones select name from pg_catalog.pg_timezone_names
  where name='UTC' or (strpos(name,'/')>0 and name not like 'posix/%' and name not like 'right/%');
alter table private.post_event_timezones enable row level security;
revoke all on private.post_event_timezones from public, anon, authenticated, service_role;
alter table private.event_details add foreign key(timezone) references private.post_event_timezones(name);
alter table private.listing_details enable row level security;
alter table private.business_details enable row level security;
alter table private.event_details enable row level security;
revoke all on private.listing_details,private.business_details,private.event_details from public, anon, authenticated, service_role;

create function internal.core_identity_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.owner_id,new.kind,new.area) is distinct from (old.id,old.owner_id,old.kind,old.area) then
    raise exception 'post identity is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.core_identity_guard() from public, anon, authenticated, service_role;
create trigger core_identity_immutable before update on private.posts for each row execute function internal.core_identity_guard();

create function internal.core_detail_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare ids uuid[]; post uuid; post_kind text; children integer;
begin
  if tg_table_name='posts' then
    ids:=case when tg_op='DELETE' then array[old.id] when tg_op='INSERT' then array[new.id] else array[old.id,new.id] end;
  else
    ids:=case when tg_op='DELETE' then array[old.post_id] when tg_op='INSERT' then array[new.post_id] else array[old.post_id,new.post_id] end;
  end if;
  foreach post in array ids loop
    select p.kind into post_kind from private.posts p where p.id=post for update;
    if not found then continue; end if; -- A deleted parent with cascaded details is valid.
    select (select count(*) from private.listing_details d where d.post_id=post)+
      (select count(*) from private.business_details d where d.post_id=post)+
      (select count(*) from private.event_details d where d.post_id=post) into children;
    if children<>1 then raise exception 'exactly one matching detail required' using errcode='23514'; end if;
  end loop;
  return null;
end;
$$;
revoke all on function internal.core_detail_guard() from public, anon, authenticated, service_role;
create constraint trigger core_post_detail after insert or update or delete on private.posts deferrable initially deferred for each row execute function internal.core_detail_guard();
create constraint trigger core_listing_detail after insert or update or delete on private.listing_details deferrable initially deferred for each row execute function internal.core_detail_guard();
create constraint trigger core_business_detail after insert or update or delete on private.business_details deferrable initially deferred for each row execute function internal.core_detail_guard();
create constraint trigger core_event_detail after insert or update or delete on private.event_details deferrable initially deferred for each row execute function internal.core_detail_guard();

create function internal.core_no_detail_truncate()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception 'detail truncation prohibited; use reviewed scoped deletion' using errcode='23514';
end;
$$;
revoke all on function internal.core_no_detail_truncate() from public, anon, authenticated, service_role;
create trigger core_listing_no_truncate before truncate on private.listing_details for each statement execute function internal.core_no_detail_truncate();
create trigger core_business_no_truncate before truncate on private.business_details for each statement execute function internal.core_no_detail_truncate();
create trigger core_event_no_truncate before truncate on private.event_details for each statement execute function internal.core_no_detail_truncate();

create function internal.create_core_draft(p_kind text,p_area text,p_category_key text,p_detail jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post uuid; starts timestamptz; ends timestamptz; tz text;
begin
  if not exists(select 1 from private.post_category_contracts c where c.category_key=p_category_key and c.kind=p_kind and c.area=p_area) then
    raise exception 'invalid kind area category' using errcode='22023';
  end if;
  if jsonb_typeof(p_detail) is distinct from 'object' or octet_length(p_detail::text)>512 then
    raise exception 'invalid detail payload' using errcode='22023';
  end if;
  if p_kind='event' then
    if not(array(select jsonb_object_keys(p_detail)) <@ array['starts_at','ends_at','timezone'])
      or jsonb_typeof(p_detail->'starts_at') is distinct from 'string' or jsonb_typeof(p_detail->'ends_at') is distinct from 'string'
      or jsonb_typeof(p_detail->'timezone') is distinct from 'string'
      or (p_detail->>'starts_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
      or (p_detail->>'ends_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' then
      raise exception 'explicit event window required' using errcode='22023';
    end if;
    starts:=(p_detail->>'starts_at')::timestamptz; ends:=(p_detail->>'ends_at')::timestamptz; tz:=p_detail->>'timezone';
    if not exists(select 1 from private.post_event_timezones z where z.name=tz) then
      raise exception 'supported IANA timezone required' using errcode='22023';
    end if;
  elsif p_detail<>'{}'::jsonb then raise exception 'detail fields not implemented in this identity fixture' using errcode='22023';
  end if;
  -- Draft allowance (DEC-29): 5 plus 1 per post in the owner's current
  -- packages (internal.draft_allowance in publication.sql). Edit copies are
  -- not counted. Never accept a caller-provided limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,417));
  if (select count(*) from private.posts p where p.owner_id=actor and p.status='draft' and p.edit_of is null)
      >=internal.draft_allowance(actor) then
    raise exception 'draft limit reached' using errcode='PT429';
  end if;
  insert into private.posts(owner_id,kind,area,category_key) values(actor,p_kind,p_area,p_category_key) returning id into post;
  if p_kind='listing' then insert into private.listing_details(post_id) values(post);
  elsif p_kind='business' then insert into private.business_details(post_id) values(post);
  else insert into private.event_details(post_id,starts_at,ends_at,timezone) values(post,starts,ends,tz); end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id',post,'kind',p_kind,'area',p_area,'category_key',p_category_key,'status','draft','revision',1);
end;
$$;
revoke all on function internal.create_core_draft(text,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.create_core_draft(text,text,text,jsonb) to authenticated;
create function api.create_core_draft(p_kind text,p_area text,p_category_key text,p_detail jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.create_core_draft(p_kind,p_area,p_category_key,p_detail);
$$;
revoke all on function api.create_core_draft(text,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function api.create_core_draft(text,text,text,jsonb) to authenticated;

create function internal.get_core_draft(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,'status',p.status,'revision',p.revision)
    into result from private.posts p where p.id=p_id and p.owner_id=actor and p.status='draft';
  return result;
end;
$$;
revoke all on function internal.get_core_draft(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.get_core_draft(uuid) to authenticated;
create function api.get_core_draft(p_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_core_draft(p_id);
$$;
revoke all on function api.get_core_draft(uuid) from public, anon, authenticated, service_role;
grant execute on function api.get_core_draft(uuid) to authenticated;
