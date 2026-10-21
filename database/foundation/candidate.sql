-- UNRELEASED BF-09 assembly; not an approved target migration.
-- Source migrations remain unchanged. See README.md and assembly.json.

-- Source: docs/backend-foundation/prototypes/transport.sql
create schema api;
create schema private;
create schema internal;
revoke all on schema api, private, internal from public;
grant usage on schema api to anon, authenticated, service_role;
grant usage on schema internal to authenticated, service_role;
-- Global PUBLIC execute must be removed, not merely its per-schema defaults.
alter default privileges revoke execute on functions from public;

-- Source: docs/backend-foundation/prototypes/listing-price-drafts.sql
-- Disposable BF-03/BF-04 fixture only, not the target post model or source DDL.
-- One price draft per Auth owner; no publication, billing, evidence or media fields.
create table private.listing_price_drafts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  category_key text not null check (category_key in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items')),
  price_mode text not null check (price_mode in ('amount','free','on_request')),
  price_cents bigint,
  price_negotiable boolean not null default false,
  revision integer not null check (revision > 0),
  expires_at timestamptz not null,
  constraint price_draft_amount_consistency check (
    (price_mode='amount' and price_cents is not null and price_cents between 1 and 9999999900) or
    (price_mode='free' and price_cents is not null and price_cents=0) or
    (price_mode='on_request' and price_cents is null)
  ),
  constraint price_draft_job_not_free check (category_key <> 'jobs_services' or price_mode <> 'free'),
  constraint price_draft_negotiability check (not price_negotiable or (price_mode='amount' and category_key <> 'jobs_services'))
);
alter table private.listing_price_drafts enable row level security;
revoke all on private.listing_price_drafts from public, anon, authenticated, service_role;

create function internal.price_draft_actor()
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := auth.uid(); claims jsonb := auth.jwt();
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean,false) then
    raise exception 'authenticated member required' using errcode='42501';
  end if;
  if not exists (select 1 from auth.sessions s where s.id::text=claims->>'session_id'
    and s.user_id=actor and (s.not_after is null or s.not_after>statement_timestamp())) then
    raise exception 'live session required' using errcode='42501';
  end if;
  return actor;
end;
$$;
revoke all on function internal.price_draft_actor() from public, anon, authenticated, service_role;
grant execute on function internal.price_draft_actor() to authenticated;

create function internal.save_listing_price_draft(p_expected_revision integer,p_category_key text,p_terms jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); price jsonb; mode text; cents numeric;
  negotiable boolean; result jsonb;
begin
  if p_expected_revision is null or p_expected_revision not between 0 and 2147483646
    or p_category_key is null or p_category_key not in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items') then
    raise exception 'invalid draft context' using errcode='22023';
  end if;
  if jsonb_typeof(p_terms) is distinct from 'object' or octet_length(p_terms::text)>512
    or not (array(select jsonb_object_keys(p_terms)) <@ array['price','negotiable']) then
    raise exception 'invalid terms' using errcode='22023';
  end if;
  price:=p_terms->'price';
  if jsonb_typeof(price) is distinct from 'object' or jsonb_typeof(price->'mode') is distinct from 'string' then
    raise exception 'explicit price mode required' using errcode='22023';
  end if;
  if p_terms ? 'negotiable' and jsonb_typeof(p_terms->'negotiable') is distinct from 'boolean' then
    raise exception 'invalid negotiability' using errcode='22023';
  end if;
  negotiable:=coalesce((p_terms->>'negotiable')::boolean,false); mode:=price->>'mode';
  if mode='amount' then
    if not (array(select jsonb_object_keys(price)) <@ array['mode','amount_cents'])
      or jsonb_typeof(price->'amount_cents') is distinct from 'number' then
      raise exception 'invalid amount fields' using errcode='22023';
    end if;
    cents:=(price->>'amount_cents')::numeric;
    if cents not between 1 and 9999999900 or mod(cents,1)<>0 then
      raise exception 'invalid amount' using errcode='22023';
    end if;
  elsif mode in ('free','on_request') then
    if not (array(select jsonb_object_keys(price)) <@ array['mode']) then
      raise exception 'hidden amount prohibited' using errcode='22023';
    end if;
    cents:=case when mode='free' then 0 else null end;
  else raise exception 'invalid price mode' using errcode='22023';
  end if;
  if (p_category_key='jobs_services' and (mode='free' or negotiable))
    or (negotiable and mode<>'amount') then
    raise exception 'invalid category price terms' using errcode='22023';
  end if;
  -- Compare-and-swap also fences concurrent initial saves and expired-draft resets.
  if p_expected_revision=0 then
    insert into private.listing_price_drafts as d (owner_id,category_key,price_mode,price_cents,price_negotiable,revision,expires_at)
      values (actor,p_category_key,mode,cents::bigint,negotiable,1,statement_timestamp()+interval '14 days')
      on conflict (owner_id) do update set category_key=excluded.category_key,price_mode=excluded.price_mode,
        price_cents=excluded.price_cents,price_negotiable=excluded.price_negotiable,revision=d.revision+1,
        expires_at=excluded.expires_at where d.expires_at<=statement_timestamp()
      returning jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,
        'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at) into result;
  else
    update private.listing_price_drafts d set category_key=p_category_key,price_mode=mode,price_cents=cents::bigint,
      price_negotiable=negotiable,revision=d.revision+1,expires_at=statement_timestamp()+interval '14 days'
      where d.owner_id=actor and d.revision=p_expected_revision and d.expires_at>statement_timestamp()
      returning jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,
        'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at) into result;
  end if;
  if result is null then raise exception 'draft changed or expired' using errcode='PT409'; end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return result;
end;
$$;
revoke all on function internal.save_listing_price_draft(integer,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.save_listing_price_draft(integer,text,jsonb) to authenticated;

create function api.save_listing_price_draft(p_expected_revision integer,p_category_key text,p_terms jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_listing_price_draft(p_expected_revision,p_category_key,p_terms);
$$;
revoke all on function api.save_listing_price_draft(integer,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function api.save_listing_price_draft(integer,text,jsonb) to authenticated;

create function internal.read_listing_price_draft()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,
    'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at)
    into result from private.listing_price_drafts d where d.owner_id=actor and d.expires_at>statement_timestamp();
  return result;
end;
$$;
revoke all on function internal.read_listing_price_draft() from public, anon, authenticated, service_role;
grant execute on function internal.read_listing_price_draft() to authenticated;
create function api.read_listing_price_draft()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.read_listing_price_draft();
$$;
revoke all on function api.read_listing_price_draft() from public, anon, authenticated, service_role;
grant execute on function api.read_listing_price_draft() to authenticated;

-- Source: docs/backend-foundation/prototypes/post-integrity.sql
-- BF-05 disposable identity/cardinality candidate. Not the final post baseline.
create table private.post_category_contracts (
  category_key text not null, kind text not null, area text not null,
  primary key (category_key,kind,area)
);
-- Test-only category bootstrap omitted; canonical reference seed follows.
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

-- Source: docs/backend-foundation/prototypes/core-listing-terms.sql
-- Local continuation only. DEC-16 permits negotiable Price on request.
-- Price metadata is advertising content, never billing/publication authority.
create function internal.validated_listing_terms(p_category_key text,p_terms jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare price jsonb; mode text; cents numeric; negotiable boolean;
begin
  if p_category_key is null or p_category_key not in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items') then
    raise exception 'invalid price category' using errcode='22023';
  end if;
  if jsonb_typeof(p_terms) is distinct from 'object' or octet_length(p_terms::text)>512
    or not(array(select jsonb_object_keys(p_terms)) <@ array['price','negotiable']) then
    raise exception 'invalid price terms' using errcode='22023';
  end if;
  price:=p_terms->'price';
  if jsonb_typeof(price) is distinct from 'object' or jsonb_typeof(price->'mode') is distinct from 'string'
    or (p_terms ? 'negotiable' and jsonb_typeof(p_terms->'negotiable') is distinct from 'boolean') then
    raise exception 'explicit price required' using errcode='22023';
  end if;
  mode:=price->>'mode'; negotiable:=coalesce((p_terms->>'negotiable')::boolean,false);
  if mode='amount' then
    if not(array(select jsonb_object_keys(price)) <@ array['mode','amount_cents']) or jsonb_typeof(price->'amount_cents') is distinct from 'number' then
      raise exception 'invalid amount fields' using errcode='22023';
    end if;
    cents:=(price->>'amount_cents')::numeric;
    if cents not between 1 and 9999999900 or mod(cents,1)<>0 then
      raise exception 'invalid amount' using errcode='22023';
    end if;
  elsif mode in ('free','on_request') then
    if not(array(select jsonb_object_keys(price)) <@ array['mode']) then
      raise exception 'hidden amount prohibited' using errcode='22023';
    end if;
    cents:=case when mode='free' then 0 else null end;
  else raise exception 'invalid price mode' using errcode='22023';
  end if;
  if (p_category_key='jobs_services' and (mode='free' or negotiable)) or (mode='free' and negotiable) then
    raise exception 'invalid category price terms' using errcode='22023';
  end if;
  return jsonb_build_object('price_mode',mode,'price_cents',cents::bigint,'price_negotiable',negotiable);
end;
$$;
revoke all on function internal.validated_listing_terms(text,jsonb) from public,anon,authenticated,service_role;

alter table private.listing_price_drafts drop constraint price_draft_negotiability;
alter table private.listing_price_drafts add constraint price_draft_negotiability check
  (not price_negotiable or (price_mode in ('amount','on_request') and category_key<>'jobs_services'));
create or replace function internal.save_listing_price_draft(p_expected_revision integer,p_category_key text,p_terms jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); terms jsonb:=internal.validated_listing_terms(p_category_key,p_terms); result jsonb;
begin
  if p_expected_revision is null or p_expected_revision not between 0 and 2147483646 then
    raise exception 'invalid draft revision' using errcode='22023';
  end if;
  if p_expected_revision=0 then
    insert into private.listing_price_drafts as d(owner_id,category_key,price_mode,price_cents,price_negotiable,revision,expires_at)
      values(actor,p_category_key,terms->>'price_mode',(terms->>'price_cents')::bigint,(terms->>'price_negotiable')::boolean,1,statement_timestamp()+interval '14 days')
      on conflict(owner_id) do update set category_key=excluded.category_key,price_mode=excluded.price_mode,
        price_cents=excluded.price_cents,price_negotiable=excluded.price_negotiable,revision=d.revision+1,expires_at=excluded.expires_at
        where d.expires_at<=statement_timestamp()
      returning jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at) into result;
  else
    update private.listing_price_drafts d set category_key=p_category_key,price_mode=terms->>'price_mode',price_cents=(terms->>'price_cents')::bigint,
      price_negotiable=(terms->>'price_negotiable')::boolean,revision=d.revision+1,expires_at=statement_timestamp()+interval '14 days'
      where d.owner_id=actor and d.revision=p_expected_revision and d.expires_at>statement_timestamp()
      returning jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at) into result;
  end if;
  if result is null then raise exception 'draft changed or expired' using errcode='PT409'; end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return result;
end;
$$;
revoke all on function internal.save_listing_price_draft(integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.save_listing_price_draft(integer,text,jsonb) to authenticated;

-- Two source categories are exercised here; final taxonomy approval is separate.
insert into private.post_category_contracts values ('electronics','listing','market'),('jobs_services','listing','market');
alter table private.listing_details add column price_mode text, add column price_cents bigint,
  add column price_negotiable boolean not null default false;
alter table private.listing_details add constraint core_price_consistency check (
  (price_mode is null and price_cents is null and not price_negotiable) or
  (price_mode is not null and (
    (price_mode='amount' and price_cents is not null and price_cents between 1 and 9999999900) or
    (price_mode='free' and price_cents is not null and price_cents=0 and not price_negotiable) or
    (price_mode='on_request' and price_cents is null)))
);
create function internal.core_listing_price_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare post uuid; category text; mode text; negotiable boolean;
begin
  if tg_table_name='posts' then post:=new.id; else post:=new.post_id; end if;
  select p.category_key into category from private.posts p where p.id=post and p.kind='listing' for update;
  if not found then return null; end if;
  select d.price_mode,d.price_negotiable into mode,negotiable from private.listing_details d where d.post_id=post;
  if category='jobs_services' and (mode='free' or negotiable) then
    raise exception 'job salary cannot be free or negotiable' using errcode='23514';
  end if;
  return null;
end;
$$;
revoke all on function internal.core_listing_price_guard() from public,anon,authenticated,service_role;
create constraint trigger core_post_price_category after insert or update on private.posts deferrable initially deferred for each row execute function internal.core_listing_price_guard();
create constraint trigger core_detail_price_category after insert or update on private.listing_details deferrable initially deferred for each row execute function internal.core_listing_price_guard();

create function internal.get_core_listing_draft(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,'status',p.status,'revision',p.revision,
    'price_mode',d.price_mode,'price_cents',d.price_cents,'price_negotiable',d.price_negotiable)
    into result from private.posts p join private.listing_details d on d.post_id=p.id
    where p.id=p_id and p.owner_id=actor and p.kind='listing' and p.status='draft'
      and p.category_key in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items');
  return result;
end;
$$;
revoke all on function internal.get_core_listing_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_core_listing_draft(uuid) to authenticated;
create function api.get_core_listing_draft(p_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_core_listing_draft(p_id);
$$;
revoke all on function api.get_core_listing_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_core_listing_draft(uuid) to authenticated;

create function internal.save_core_listing_terms(p_id uuid,p_expected_revision integer,p_terms jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post private.posts%rowtype; terms jsonb;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_id and copy.owner_id=actor for update of original;
  if p_expected_revision is null or p_expected_revision not between 1 and 2147483646 then
    raise exception 'invalid post revision' using errcode='22023';
  end if;
  select p.* into post from private.posts p where p.id=p_id and p.owner_id=actor and p.kind='listing' and p.status='draft'
    and p.category_key in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items') for update;
  if not found or post.revision<>p_expected_revision then
    raise exception 'draft unavailable or changed' using errcode='PT409';
  end if;
  terms:=internal.validated_listing_terms(post.category_key,p_terms);
  update private.listing_details d set price_mode=terms->>'price_mode',price_cents=(terms->>'price_cents')::bigint,
    price_negotiable=(terms->>'price_negotiable')::boolean where d.post_id=post.id;
  if not found then raise exception 'missing listing detail' using errcode='23514'; end if;
  update private.posts p set revision=p.revision+1,content_updated_at=statement_timestamp() where p.id=post.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return internal.get_core_listing_draft(post.id);
end;
$$;
revoke all on function internal.save_core_listing_terms(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.save_core_listing_terms(uuid,integer,jsonb) to authenticated;
create function api.save_core_listing_terms(p_id uuid,p_expected_revision integer,p_terms jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_core_listing_terms(p_id,p_expected_revision,p_terms);
$$;
revoke all on function api.save_core_listing_terms(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function api.save_core_listing_terms(uuid,integer,jsonb) to authenticated;

-- Source: docs/backend-foundation/prototypes/taxonomy-reference.sql
-- BF-06 reference taxonomy, locality and category field registry candidate.
-- Seeds come from taxonomy-reference-seed.sql, generated from the TypeScript
-- reference catalogue so the browser registry and database cannot drift.
-- Reference changes are reviewed migrations; nothing reconstructs categories
-- from legacy enums at runtime.

create table private.reference_catalog_versions (
  version integer primary key check (version > 0),
  content_hash text not null unique check (content_hash ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default statement_timestamp()
);

create table private.categories (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  kind text not null check (kind in ('listing', 'business', 'event')),
  area text not null check (area in ('market', 'business', 'tourism_events')),
  label text not null check (length(label) between 1 and 120),
  activity_required boolean not null,
  sort_order integer not null,
  reference_version integer not null references private.reference_catalog_versions (version),
  unique (key, kind, area),
  check ((kind = 'listing' and area = 'market')
    or (kind = 'business' and area in ('business', 'tourism_events'))
    or (kind = 'event' and area = 'tourism_events'))
);

create table private.category_activities (
  category_key text not null references private.categories (key),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label text not null check (length(label) between 1 and 120),
  field_group text check (field_group in ('A', 'B', 'C', 'D', 'E', 'F')),
  sort_order integer not null,
  primary key (category_key, key)
);

create table private.provinces (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{0,79}$'),
  code text not null unique,
  label text not null unique,
  sort_order integer not null
);

create table private.cities (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{0,79}$'),
  province_id text not null references private.provinces (id),
  label text not null,
  sort_order integer not null,
  unique (id, province_id)
);

create table private.city_aliases (
  city_id text not null references private.cities (id),
  alias_normalized text not null check (alias_normalized = lower(alias_normalized) and length(alias_normalized) between 1 and 120),
  primary key (city_id, alias_normalized)
);
create index city_aliases_lookup_idx on private.city_aliases (alias_normalized);

create table private.category_fields (
  category_key text not null references private.categories (key),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label text not null,
  renderer text not null check (renderer in ('text', 'number', 'select', 'boolean', 'checklist', 'money', 'combobox')),
  option_authority text not null check (option_authority in ('closed', 'suggestions', 'none')),
  required boolean not null,
  validation jsonb not null check (jsonb_typeof(validation) = 'object'),
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  unit text,
  depends_on text,
  depends_on_values jsonb check (depends_on_values is null or jsonb_typeof(depends_on_values) = 'array'),
  dynamic_maximum text,
  facet_kind text check (facet_kind in ('choice', 'contains', 'boolean', 'range')),
  sort_order integer not null,
  primary key (category_key, key),
  check (facet_kind is null or renderer not in ('text', 'combobox')),
  check (facet_kind is distinct from 'choice' or (renderer = 'select' and option_authority = 'closed'))
);

alter table private.reference_catalog_versions enable row level security;
alter table private.categories enable row level security;
alter table private.category_activities enable row level security;
alter table private.provinces enable row level security;
alter table private.cities enable row level security;
alter table private.city_aliases enable row level security;
alter table private.category_fields enable row level security;
revoke all on private.reference_catalog_versions, private.categories, private.category_activities,
  private.provinces, private.cities, private.city_aliases, private.category_fields
  from public, anon, authenticated, service_role;

-- Posts gain an optional activity; the composite key keeps it inside its category.
alter table private.posts add column activity_key text;
alter table private.posts add constraint posts_activity_fkey
  foreign key (category_key, activity_key) references private.category_activities (category_key, key);

create function internal.post_activity_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if exists (select 1 from private.categories c where c.key = new.category_key and c.activity_required)
    and new.activity_key is null then
    raise exception 'activity required for this category' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.post_activity_guard() from public, anon, authenticated, service_role;
create trigger post_activity_guard before insert or update of category_key, activity_key on private.posts
  for each row execute function internal.post_activity_guard();

-- Source: docs/backend-foundation/prototypes/taxonomy-reference-seed.sql
-- Generated by scripts/build-taxonomy-sql.mjs from src/lib/domains/taxonomy/reference.json. Do not edit by hand.
-- Reference content hash: T5xVchXRaGmDFxPnJH4JjyNY-EA2UbwHMWSdJmpd_QY
insert into private.reference_catalog_versions (version, content_hash) values
  (1, 'T5xVchXRaGmDFxPnJH4JjyNY-EA2UbwHMWSdJmpd_QY');

insert into private.categories (key, kind, area, label, activity_required, sort_order, reference_version) values
  ('property', 'listing', 'market', 'Property (For Sale & To Rent)', false, 1, 1),
  ('vehicles', 'listing', 'market', 'Vehicles (Cars, Bakkies & Commercial)', false, 2, 1),
  ('auto_parts', 'listing', 'market', 'Vehicle Parts & Accessories', false, 3, 1),
  ('electronics', 'listing', 'market', 'Electronics & Tech', false, 4, 1),
  ('home_lifestyle', 'listing', 'market', 'Furniture & Home', false, 5, 1),
  ('jobs_services', 'listing', 'market', 'Jobs', false, 6, 1),
  ('farming_agriculture', 'listing', 'market', 'Farming & Agriculture', false, 7, 1),
  ('baby_kids', 'listing', 'market', 'Baby & Kids', false, 8, 1),
  ('clothing_accessories', 'listing', 'market', 'Clothing & Accessories', false, 9, 1),
  ('sports_hobbies', 'listing', 'market', 'Sports, Hobbies & Leisure', false, 10, 1),
  ('other_items', 'listing', 'market', 'Other Items', false, 11, 1),
  ('automotive_services', 'business', 'business', 'Automotive Sales & Services', false, 12, 1),
  ('beauty_personal', 'business', 'business', 'Beauty & Personal Care', false, 13, 1),
  ('trade_maintenance', 'business', 'business', 'Building & Trade Services', false, 14, 1),
  ('cleaning_garden', 'business', 'business', 'Cleaning & Garden Services', false, 15, 1),
  ('fashion_accessories', 'business', 'business', 'Clothing & Accessories', false, 16, 1),
  ('community_personal', 'business', 'business', 'Community & Personal Services', false, 17, 1),
  ('education_training', 'business', 'business', 'Education & Childcare', false, 18, 1),
  ('electronics_tech', 'business', 'business', 'Electronics & Technology', false, 19, 1),
  ('events_entertainment', 'business', 'business', 'Events & Entertainment Services', false, 20, 1),
  ('fitness_wellness', 'business', 'business', 'Fitness & Wellness', false, 21, 1),
  ('home_living', 'business', 'business', 'Furniture & Homeware', false, 22, 1),
  ('groceries_essentials', 'business', 'business', 'Groceries & Food Shops', false, 23, 1),
  ('health_medical', 'business', 'business', 'Health & Medical', false, 24, 1),
  ('pets_animals', 'business', 'business', 'Pets & Animal Services', false, 25, 1),
  ('professional_services', 'business', 'business', 'Professional & Business Services', false, 26, 1),
  ('food_dining', 'business', 'business', 'Restaurants & Catering', false, 27, 1),
  ('transport_storage', 'business', 'business', 'Transport, Delivery & Storage', false, 28, 1),
  ('general_other', 'business', 'business', 'Other Businesses', false, 29, 1),
  ('tourism_hospitality', 'business', 'tourism_events', 'Tourism & Hospitality', true, 30, 1),
  ('events', 'event', 'tourism_events', 'Events', true, 31, 1);

insert into private.category_activities (category_key, key, label, field_group, sort_order) values
  ('automotive_services', 'car_dealer_new', 'Car Dealer (New)', null, 1),
  ('automotive_services', 'car_dealer_used', 'Car Dealer (Used / Pre-Owned)', null, 2),
  ('automotive_services', 'mechanic_workshop', 'Mechanic / Workshop', null, 3),
  ('automotive_services', 'panel_beater', 'Panel Beater / Body Shop', null, 4),
  ('automotive_services', 'auto_electrician', 'Auto Electrician', null, 5),
  ('automotive_services', 'tyre_shop', 'Tyre Shop', null, 6),
  ('automotive_services', 'car_wash', 'Car Wash', null, 7),
  ('automotive_services', 'car_audio_accessories', 'Car Audio / Accessories', null, 8),
  ('automotive_services', 'towing_service', 'Towing Service', null, 9),
  ('beauty_personal', 'hair_salon_barber', 'Hair Salon / Barbershop', null, 10),
  ('beauty_personal', 'beauty_nail_salon', 'Beauty & Nail Salon', null, 11),
  ('beauty_personal', 'braiding_extensions', 'Braiding / Hair Extensions', null, 12),
  ('beauty_personal', 'makeup_artist', 'Makeup Artist', null, 13),
  ('beauty_personal', 'lashes_brows', 'Lashes & Brows', null, 14),
  ('trade_maintenance', 'plumber', 'Plumber', null, 15),
  ('trade_maintenance', 'electrician', 'Electrician', null, 16),
  ('trade_maintenance', 'builder_contractor', 'Builder / Contractor', null, 17),
  ('trade_maintenance', 'painter', 'Painter', null, 18),
  ('trade_maintenance', 'locksmith', 'Locksmith', null, 19),
  ('trade_maintenance', 'handyman', 'Handyman / General Repairs', null, 20),
  ('trade_maintenance', 'hvac_aircon', 'HVAC / Air Conditioning', null, 21),
  ('cleaning_garden', 'cleaning_service', 'Cleaning Service', null, 22),
  ('cleaning_garden', 'pest_control', 'Pest Control', null, 23),
  ('cleaning_garden', 'landscaping', 'Landscaping / Garden Service', null, 24),
  ('fashion_accessories', 'clothing_store', 'Clothing Store', null, 25),
  ('fashion_accessories', 'shoe_store', 'Shoe Store', null, 26),
  ('fashion_accessories', 'jewelry_watches', 'Jewelry & Watches', null, 27),
  ('fashion_accessories', 'bags_luggage', 'Bags & Luggage', null, 28),
  ('fashion_accessories', 'tailoring_alterations', 'Tailoring & Alterations', null, 29),
  ('fashion_accessories', 'thrift_vintage', 'Thrift / Vintage', null, 30),
  ('fashion_accessories', 'general_accessories', 'General Accessories', null, 31),
  ('community_personal', 'religious_org', 'Religious Organisation', null, 32),
  ('community_personal', 'ngo_npo', 'NGO / NPO', null, 33),
  ('community_personal', 'funeral_services', 'Funeral Services', null, 34),
  ('community_personal', 'home_based_care', 'Home-Based Care', null, 35),
  ('education_training', 'school', 'School (Primary / Secondary)', null, 36),
  ('education_training', 'creche_daycare', 'Crèche / Day Care', null, 37),
  ('education_training', 'tutoring', 'Tutoring', null, 38),
  ('education_training', 'driving_school', 'Driving School', null, 39),
  ('education_training', 'skills_training', 'Short Courses / Skills Training', null, 40),
  ('education_training', 'college_university', 'College / University', null, 41),
  ('education_training', 'music_art_school', 'Music / Art School', null, 42),
  ('electronics_tech', 'mobile_phone_shop', 'Mobile Phone Shop', null, 43),
  ('electronics_tech', 'computer_it', 'Computer & IT Store', null, 44),
  ('electronics_tech', 'gaming', 'Gaming', null, 45),
  ('electronics_tech', 'appliance_repair', 'Appliance Repair', null, 46),
  ('electronics_tech', 'audio_visual', 'Audio & Visual', null, 47),
  ('electronics_tech', 'general_electronics', 'General Electronics', null, 48),
  ('events_entertainment', 'event_planner', 'Event Planner / Coordinator', null, 49),
  ('events_entertainment', 'dj_live_music', 'DJ / Live Music', null, 50),
  ('events_entertainment', 'photographer_videographer', 'Photographer / Videographer', null, 51),
  ('events_entertainment', 'venue_hire', 'Venue Hire', null, 52),
  ('events_entertainment', 'decor_hiring', 'Décor & Hiring', null, 53),
  ('events_entertainment', 'kids_entertainment', 'Kids Entertainment', null, 54),
  ('events_entertainment', 'party_supplies', 'Party Supplies', null, 55),
  ('fitness_wellness', 'spa_wellness', 'Spa & Wellness', null, 56),
  ('fitness_wellness', 'gym_fitness', 'Gym / Fitness Studio', null, 57),
  ('fitness_wellness', 'personal_trainer', 'Personal Trainer', null, 58),
  ('fitness_wellness', 'yoga_pilates', 'Yoga / Pilates Studio', null, 59),
  ('fitness_wellness', 'massage_therapist', 'Massage Therapist', null, 60),
  ('home_living', 'furniture_store', 'Furniture Store', null, 61),
  ('home_living', 'interior_decor', 'Interior Decor', null, 62),
  ('home_living', 'hardware_diy', 'Hardware / DIY', null, 63),
  ('home_living', 'garden_outdoor', 'Garden & Outdoor', null, 64),
  ('home_living', 'appliance_store', 'Appliance Store', null, 65),
  ('home_living', 'linen_homeware', 'Linen & Homeware', null, 66),
  ('groceries_essentials', 'supermarket', 'Supermarket', null, 67),
  ('groceries_essentials', 'spaza_convenience', 'Spaza / Convenience Shop', null, 68),
  ('groceries_essentials', 'butchery', 'Butchery', null, 69),
  ('groceries_essentials', 'fruit_veg', 'Fruit & Veg', null, 70),
  ('groceries_essentials', 'specialty_organic', 'Specialty / Organic', null, 71),
  ('groceries_essentials', 'liquor_store', 'Liquor Store', null, 72),
  ('health_medical', 'doctor_medical', 'Doctor / Medical Practice', null, 73),
  ('health_medical', 'dentist', 'Dentist', null, 74),
  ('health_medical', 'optometrist', 'Optometrist', null, 75),
  ('health_medical', 'pharmacy', 'Pharmacy / Chemist', null, 76),
  ('health_medical', 'physio_chiro', 'Physiotherapy / Chiropractic', null, 77),
  ('health_medical', 'traditional_healer', 'Traditional Healer', null, 78),
  ('health_medical', 'mental_health', 'Mental Health / Counselling', null, 79),
  ('pets_animals', 'pet_services', 'Pet Services', null, 80),
  ('pets_animals', 'vet_clinic', 'Veterinary Clinic', null, 81),
  ('pets_animals', 'pet_grooming', 'Pet Grooming', null, 82),
  ('pets_animals', 'pet_shop', 'Pet Shop', null, 83),
  ('pets_animals', 'pet_boarding', 'Boarding / Kennels', null, 84),
  ('professional_services', 'attorney_legal', 'Attorney / Legal', null, 85),
  ('professional_services', 'accounting_bookkeeping', 'Accounting / Bookkeeping', null, 86),
  ('professional_services', 'marketing_advertising', 'Marketing / Advertising', null, 87),
  ('professional_services', 'it_software', 'IT / Software', null, 88),
  ('professional_services', 'hr_recruitment', 'HR / Recruitment', null, 89),
  ('professional_services', 'real_estate', 'Real Estate Agent', null, 90),
  ('professional_services', 'insurance_broker', 'Insurance Broker', null, 91),
  ('professional_services', 'financial_advisor', 'Financial Advisor', null, 92),
  ('professional_services', 'consulting_general', 'Consulting (General)', null, 93),
  ('professional_services', 'notary', 'Notary / Commissioner of Oaths', null, 94),
  ('professional_services', 'printing_signage', 'Printing / Signage', null, 95),
  ('food_dining', 'restaurant', 'Restaurant', null, 96),
  ('food_dining', 'cafe_coffee', 'Café / Coffee Shop', null, 97),
  ('food_dining', 'fast_food_takeaway', 'Fast Food / Takeaway', null, 98),
  ('food_dining', 'bakery_patisserie', 'Bakery & Patisserie', null, 99),
  ('food_dining', 'catering', 'Catering', null, 100),
  ('food_dining', 'food_truck', 'Food Truck', null, 101),
  ('food_dining', 'shisanyama_braai', 'Shisanyama / Braai', null, 102),
  ('food_dining', 'bar_lounge', 'Bar / Lounge', null, 103),
  ('transport_storage', 'courier_logistics', 'Courier / Logistics', null, 104),
  ('transport_storage', 'shuttle_transport', 'Shuttle / Transport Service', null, 105),
  ('transport_storage', 'storage_warehousing', 'Storage / Warehousing', null, 106),
  ('transport_storage', 'removals_moving', 'Removals / Moving', null, 107),
  ('general_other', 'general_retail', 'General Retail', null, 108),
  ('general_other', 'other', 'Other', null, 109),
  ('tourism_hospitality', 'hotel_resort', 'Hotel / Resort', 'A', 110),
  ('tourism_hospitality', 'guest_house_bnb', 'Guest House / B&B', 'A', 111),
  ('tourism_hospitality', 'lodge_game_lodge', 'Lodge / Game Lodge', 'A', 112),
  ('tourism_hospitality', 'backpackers_hostel', 'Backpackers / Hostel', 'A', 113),
  ('tourism_hospitality', 'self_catering', 'Self-Catering / Vacation Rental', 'A', 114),
  ('tourism_hospitality', 'tour_operator', 'Tour Operator', 'C', 115),
  ('tourism_hospitality', 'travel_agency', 'Travel Agency', 'D', 116),
  ('tourism_hospitality', 'safari_wildlife', 'Safari & Wildlife Experience', 'C', 117),
  ('tourism_hospitality', 'adventure_activities', 'Adventure Activities', 'C', 118),
  ('tourism_hospitality', 'cultural_heritage', 'Cultural & Heritage Site', 'E', 119),
  ('tourism_hospitality', 'car_rental_tourism', 'Car Rental (Tourism)', 'F', 120),
  ('tourism_hospitality', 'campground_caravan', 'Campground / Caravan Park', 'A', 121),
  ('tourism_hospitality', 'spa_wellness_retreat', 'Spa & Wellness Retreat', 'B', 122),
  ('tourism_hospitality', 'tourist_attraction', 'Tourist Attraction / Theme Park', 'E', 123),
  ('events', 'festival_concert', 'Festival / Concert', null, 124),
  ('events', 'conference_seminar', 'Conference / Seminar', null, 125),
  ('events', 'market_expo', 'Market / Expo / Fair', null, 126),
  ('events', 'sports_event', 'Sports Event', null, 127),
  ('events', 'cultural_heritage', 'Cultural Event / Heritage Day', null, 128),
  ('events', 'food_wine', 'Food & Wine Event', null, 129),
  ('events', 'outdoor_adventure', 'Outdoor / Adventure', null, 130),
  ('events', 'workshop_masterclass', 'Workshop / Masterclass', null, 131),
  ('events', 'charity_fundraiser', 'Charity / Fundraiser', null, 132),
  ('events', 'community_gathering', 'Community Gathering', null, 133),
  ('events', 'comedy_theatre', 'Comedy / Theatre / Show', null, 134),
  ('events', 'kids_family', 'Kids / Family Event', null, 135),
  ('events', 'nightlife_party', 'Nightlife / Party', null, 136);

insert into private.provinces (id, code, label, sort_order) values
  ('gp', 'GP', 'Gauteng', 1),
  ('wc', 'WC', 'Western Cape', 2),
  ('kzn', 'KZN', 'KwaZulu-Natal', 3),
  ('ec', 'EC', 'Eastern Cape', 4),
  ('fs', 'FS', 'Free State', 5),
  ('mp', 'MP', 'Mpumalanga', 6),
  ('lp', 'LP', 'Limpopo', 7),
  ('nw', 'NW', 'North West', 8),
  ('nc', 'NC', 'Northern Cape', 9);

insert into private.cities (id, province_id, label, sort_order) values
  ('gp_johannesburg', 'gp', 'Johannesburg', 1),
  ('gp_pretoria', 'gp', 'Pretoria', 2),
  ('gp_centurion', 'gp', 'Centurion', 3),
  ('gp_sandton', 'gp', 'Sandton', 4),
  ('gp_soweto', 'gp', 'Soweto', 5),
  ('gp_midrand', 'gp', 'Midrand', 6),
  ('gp_randburg', 'gp', 'Randburg', 7),
  ('gp_roodepoort', 'gp', 'Roodepoort', 8),
  ('gp_boksburg', 'gp', 'Boksburg', 9),
  ('gp_benoni', 'gp', 'Benoni', 10),
  ('gp_kempton_park', 'gp', 'Kempton Park', 11),
  ('gp_germiston', 'gp', 'Germiston', 12),
  ('gp_springs', 'gp', 'Springs', 13),
  ('gp_alberton', 'gp', 'Alberton', 14),
  ('gp_krugersdorp', 'gp', 'Krugersdorp', 15),
  ('gp_vereeniging', 'gp', 'Vereeniging', 16),
  ('gp_vanderbijlpark', 'gp', 'Vanderbijlpark', 17),
  ('wc_cape_town', 'wc', 'Cape Town', 18),
  ('wc_stellenbosch', 'wc', 'Stellenbosch', 19),
  ('wc_paarl', 'wc', 'Paarl', 20),
  ('wc_george', 'wc', 'George', 21),
  ('wc_knysna', 'wc', 'Knysna', 22),
  ('wc_mossel_bay', 'wc', 'Mossel Bay', 23),
  ('wc_worcester', 'wc', 'Worcester', 24),
  ('wc_hermanus', 'wc', 'Hermanus', 25),
  ('wc_franschhoek', 'wc', 'Franschhoek', 26),
  ('wc_somerset_west', 'wc', 'Somerset West', 27),
  ('wc_bellville', 'wc', 'Bellville', 28),
  ('wc_durbanville', 'wc', 'Durbanville', 29),
  ('wc_malmesbury', 'wc', 'Malmesbury', 30),
  ('kzn_durban', 'kzn', 'Durban', 31),
  ('kzn_pietermaritzburg', 'kzn', 'Pietermaritzburg', 32),
  ('kzn_richards_bay', 'kzn', 'Richards Bay', 33),
  ('kzn_empangeni', 'kzn', 'Empangeni', 34),
  ('kzn_newcastle', 'kzn', 'Newcastle', 35),
  ('kzn_umhlanga', 'kzn', 'Umhlanga', 36),
  ('kzn_ballito', 'kzn', 'Ballito', 37),
  ('kzn_pinetown', 'kzn', 'Pinetown', 38),
  ('kzn_chatsworth', 'kzn', 'Chatsworth', 39),
  ('kzn_ladysmith', 'kzn', 'Ladysmith', 40),
  ('kzn_port_shepstone', 'kzn', 'Port Shepstone', 41),
  ('kzn_margate', 'kzn', 'Margate', 42),
  ('kzn_scottburgh', 'kzn', 'Scottburgh', 43),
  ('ec_port_elizabeth_gqeberha', 'ec', 'Port Elizabeth (Gqeberha)', 44),
  ('ec_east_london', 'ec', 'East London', 45),
  ('ec_mthatha', 'ec', 'Mthatha', 46),
  ('ec_bhisho', 'ec', 'Bhisho', 47),
  ('ec_grahamstown_makhanda', 'ec', 'Grahamstown (Makhanda)', 48),
  ('ec_queenstown', 'ec', 'Queenstown', 49),
  ('ec_king_williams_town', 'ec', 'King Williams Town', 50),
  ('ec_cradock', 'ec', 'Cradock', 51),
  ('ec_uitenhage', 'ec', 'Uitenhage', 52),
  ('fs_bloemfontein', 'fs', 'Bloemfontein', 53),
  ('fs_welkom', 'fs', 'Welkom', 54),
  ('fs_kroonstad', 'fs', 'Kroonstad', 55),
  ('fs_bethlehem', 'fs', 'Bethlehem', 56),
  ('fs_sasolburg', 'fs', 'Sasolburg', 57),
  ('fs_parys', 'fs', 'Parys', 58),
  ('fs_virginia', 'fs', 'Virginia', 59),
  ('fs_phuthaditjhaba', 'fs', 'Phuthaditjhaba', 60),
  ('mp_mbombela_nelspruit', 'mp', 'Mbombela (Nelspruit)', 61),
  ('mp_witbank_emalahleni', 'mp', 'Witbank (Emalahleni)', 62),
  ('mp_secunda', 'mp', 'Secunda', 63),
  ('mp_middelburg', 'mp', 'Middelburg', 64),
  ('mp_white_river', 'mp', 'White River', 65),
  ('mp_barberton', 'mp', 'Barberton', 66),
  ('mp_standerton', 'mp', 'Standerton', 67),
  ('mp_ermelo', 'mp', 'Ermelo', 68),
  ('lp_polokwane', 'lp', 'Polokwane', 69),
  ('lp_tzaneen', 'lp', 'Tzaneen', 70),
  ('lp_mokopane', 'lp', 'Mokopane', 71),
  ('lp_musina', 'lp', 'Musina', 72),
  ('lp_louis_trichardt', 'lp', 'Louis Trichardt', 73),
  ('lp_thohoyandou', 'lp', 'Thohoyandou', 74),
  ('lp_phalaborwa', 'lp', 'Phalaborwa', 75),
  ('lp_lephalale', 'lp', 'Lephalale', 76),
  ('nw_rustenburg', 'nw', 'Rustenburg', 77),
  ('nw_mahikeng', 'nw', 'Mahikeng', 78),
  ('nw_potchefstroom_tlokwe', 'nw', 'Potchefstroom (Tlokwe)', 79),
  ('nw_klerksdorp', 'nw', 'Klerksdorp', 80),
  ('nw_brits', 'nw', 'Brits', 81),
  ('nw_sun_city', 'nw', 'Sun City', 82),
  ('nw_hartbeespoort', 'nw', 'Hartbeespoort', 83),
  ('nw_lichtenburg', 'nw', 'Lichtenburg', 84),
  ('nc_kimberley', 'nc', 'Kimberley', 85),
  ('nc_upington', 'nc', 'Upington', 86),
  ('nc_springbok', 'nc', 'Springbok', 87),
  ('nc_de_aar', 'nc', 'De Aar', 88),
  ('nc_kuruman', 'nc', 'Kuruman', 89),
  ('nc_kathu', 'nc', 'Kathu', 90);

insert into private.city_aliases (city_id, alias_normalized) values
  ('gp_johannesburg', 'johannesburg'),
  ('gp_pretoria', 'pretoria'),
  ('gp_centurion', 'centurion'),
  ('gp_sandton', 'sandton'),
  ('gp_soweto', 'soweto'),
  ('gp_midrand', 'midrand'),
  ('gp_randburg', 'randburg'),
  ('gp_roodepoort', 'roodepoort'),
  ('gp_boksburg', 'boksburg'),
  ('gp_benoni', 'benoni'),
  ('gp_kempton_park', 'kempton park'),
  ('gp_germiston', 'germiston'),
  ('gp_springs', 'springs'),
  ('gp_alberton', 'alberton'),
  ('gp_krugersdorp', 'krugersdorp'),
  ('gp_vereeniging', 'vereeniging'),
  ('gp_vanderbijlpark', 'vanderbijlpark'),
  ('wc_cape_town', 'cape town'),
  ('wc_stellenbosch', 'stellenbosch'),
  ('wc_paarl', 'paarl'),
  ('wc_george', 'george'),
  ('wc_knysna', 'knysna'),
  ('wc_mossel_bay', 'mossel bay'),
  ('wc_worcester', 'worcester'),
  ('wc_hermanus', 'hermanus'),
  ('wc_franschhoek', 'franschhoek'),
  ('wc_somerset_west', 'somerset west'),
  ('wc_bellville', 'bellville'),
  ('wc_durbanville', 'durbanville'),
  ('wc_malmesbury', 'malmesbury'),
  ('kzn_durban', 'durban'),
  ('kzn_pietermaritzburg', 'pietermaritzburg'),
  ('kzn_richards_bay', 'richards bay'),
  ('kzn_empangeni', 'empangeni'),
  ('kzn_newcastle', 'newcastle'),
  ('kzn_umhlanga', 'umhlanga'),
  ('kzn_ballito', 'ballito'),
  ('kzn_pinetown', 'pinetown'),
  ('kzn_chatsworth', 'chatsworth'),
  ('kzn_ladysmith', 'ladysmith'),
  ('kzn_port_shepstone', 'port shepstone'),
  ('kzn_margate', 'margate'),
  ('kzn_scottburgh', 'scottburgh'),
  ('ec_port_elizabeth_gqeberha', 'port elizabeth gqeberha'),
  ('ec_port_elizabeth_gqeberha', 'port elizabeth'),
  ('ec_port_elizabeth_gqeberha', 'gqeberha'),
  ('ec_east_london', 'east london'),
  ('ec_mthatha', 'mthatha'),
  ('ec_bhisho', 'bhisho'),
  ('ec_grahamstown_makhanda', 'grahamstown makhanda'),
  ('ec_grahamstown_makhanda', 'grahamstown'),
  ('ec_grahamstown_makhanda', 'makhanda'),
  ('ec_queenstown', 'queenstown'),
  ('ec_king_williams_town', 'king williams town'),
  ('ec_cradock', 'cradock'),
  ('ec_uitenhage', 'uitenhage'),
  ('fs_bloemfontein', 'bloemfontein'),
  ('fs_welkom', 'welkom'),
  ('fs_kroonstad', 'kroonstad'),
  ('fs_bethlehem', 'bethlehem'),
  ('fs_sasolburg', 'sasolburg'),
  ('fs_parys', 'parys'),
  ('fs_virginia', 'virginia'),
  ('fs_phuthaditjhaba', 'phuthaditjhaba'),
  ('mp_mbombela_nelspruit', 'mbombela nelspruit'),
  ('mp_mbombela_nelspruit', 'mbombela'),
  ('mp_mbombela_nelspruit', 'nelspruit'),
  ('mp_witbank_emalahleni', 'witbank emalahleni'),
  ('mp_witbank_emalahleni', 'witbank'),
  ('mp_witbank_emalahleni', 'emalahleni'),
  ('mp_secunda', 'secunda'),
  ('mp_middelburg', 'middelburg'),
  ('mp_white_river', 'white river'),
  ('mp_barberton', 'barberton'),
  ('mp_standerton', 'standerton'),
  ('mp_ermelo', 'ermelo'),
  ('lp_polokwane', 'polokwane'),
  ('lp_tzaneen', 'tzaneen'),
  ('lp_mokopane', 'mokopane'),
  ('lp_musina', 'musina'),
  ('lp_louis_trichardt', 'louis trichardt'),
  ('lp_thohoyandou', 'thohoyandou'),
  ('lp_phalaborwa', 'phalaborwa'),
  ('lp_lephalale', 'lephalale'),
  ('nw_rustenburg', 'rustenburg'),
  ('nw_mahikeng', 'mahikeng'),
  ('nw_potchefstroom_tlokwe', 'potchefstroom tlokwe'),
  ('nw_potchefstroom_tlokwe', 'potchefstroom'),
  ('nw_potchefstroom_tlokwe', 'tlokwe'),
  ('nw_klerksdorp', 'klerksdorp'),
  ('nw_brits', 'brits'),
  ('nw_sun_city', 'sun city'),
  ('nw_hartbeespoort', 'hartbeespoort'),
  ('nw_lichtenburg', 'lichtenburg'),
  ('nc_kimberley', 'kimberley'),
  ('nc_upington', 'upington'),
  ('nc_springbok', 'springbok'),
  ('nc_de_aar', 'de aar'),
  ('nc_kuruman', 'kuruman'),
  ('nc_kathu', 'kathu');

insert into private.category_fields (category_key, key, label, renderer, option_authority, required, validation, options, unit, depends_on, depends_on_values, dynamic_maximum, facet_kind, sort_order) values
  ('property', 'property_type', 'Property Type', 'select', 'closed', true, '{"type":"string","enum":["house","apartment","land","commercial","room"]}'::jsonb, '[{"value":"house","label":"House"},{"value":"apartment","label":"Apartment / Flat"},{"value":"land","label":"Land / Plot"},{"value":"commercial","label":"Commercial"},{"value":"room","label":"Room"}]'::jsonb, null, null, null, null, 'choice', 1),
  ('property', 'listing_intent', 'For sale or to rent?', 'select', 'closed', true, '{"type":"string","enum":["sale","rent"]}'::jsonb, '[{"value":"sale","label":"For Sale"},{"value":"rent","label":"To Rent"}]'::jsonb, null, null, null, null, 'choice', 2),
  ('property', 'bedrooms', 'Bedrooms', 'number', 'none', false, '{"type":"integer","minimum":0,"maximum":20}'::jsonb, null, null, null, null, null, 'range', 3),
  ('property', 'bathrooms', 'Bathrooms', 'number', 'none', false, '{"type":"integer","minimum":0,"maximum":10}'::jsonb, null, null, null, null, null, 'range', 4),
  ('property', 'parking_spots', 'Parking Spaces', 'number', 'none', false, '{"type":"integer","minimum":0,"maximum":10}'::jsonb, null, null, null, null, null, 'range', 5),
  ('property', 'floor_size_sqm', 'Floor Size', 'number', 'none', false, '{"type":"number","minimum":1,"maximum":100000}'::jsonb, null, 'm²', null, null, null, 'range', 6),
  ('property', 'erf_size_sqm', 'Erf / Stand Size', 'number', 'none', false, '{"type":"number","minimum":1,"maximum":1000000}'::jsonb, null, 'm²', null, null, null, 'range', 7),
  ('property', 'furnished', 'Furnished', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 8),
  ('property', 'pets_allowed', 'Pets Allowed', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 9),
  ('property', 'levy_cents', 'Levy / Body Corporate', 'money', 'none', false, '{"type":"integer","minimum":0,"maximum":100000000000}'::jsonb, null, 'ZAR_cents', null, null, null, 'range', 10),
  ('property', 'rates_taxes_cents', 'Rates & Taxes', 'money', 'none', false, '{"type":"integer","minimum":0,"maximum":100000000000}'::jsonb, null, 'ZAR_cents', null, null, null, 'range', 11),
  ('property', 'property_subtype', 'Property Sub-type', 'select', 'closed', false, '{"type":"string","enum":["townhouse","cluster","simplex","duplex","freestanding","sectional_title","estate"]}'::jsonb, '[{"value":"townhouse","label":"Townhouse"},{"value":"cluster","label":"Cluster"},{"value":"simplex","label":"Simplex"},{"value":"duplex","label":"Duplex"},{"value":"freestanding","label":"Freestanding"},{"value":"sectional_title","label":"Sectional Title"},{"value":"estate","label":"Estate"}]'::jsonb, null, null, null, null, 'choice', 12),
  ('property', 'security_features', 'Security Features', 'checklist', 'closed', false, '{"maxItems":30,"type":"array","items":{"type":"string","maxLength":80,"enum":["security_estate","electric_fence","alarm","armed_response","security_guards","cctv","burglar_bars","security_gate"]}}'::jsonb, '[{"value":"security_estate","label":"Security Estate"},{"value":"electric_fence","label":"Electric Fence"},{"value":"alarm","label":"Alarm"},{"value":"armed_response","label":"Armed Response"},{"value":"security_guards","label":"Security Guards"},{"value":"cctv","label":"CCTV"},{"value":"burglar_bars","label":"Burglar Bars"},{"value":"security_gate","label":"Security Gate"}]'::jsonb, null, null, null, null, 'contains', 13),
  ('property', 'pool', 'Swimming Pool', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 14),
  ('property', 'garden', 'Garden', 'select', 'closed', false, '{"type":"string","enum":["none","small","medium","large","communal"]}'::jsonb, '[{"value":"none","label":"None"},{"value":"small","label":"Small"},{"value":"medium","label":"Medium"},{"value":"large","label":"Large"},{"value":"communal","label":"Communal"}]'::jsonb, null, null, null, null, 'choice', 15),
  ('property', 'domestic_quarters', 'Domestic Quarters / Flatlet', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 16),
  ('property', 'garage', 'Garages', 'number', 'none', false, '{"type":"integer","minimum":0,"maximum":20}'::jsonb, null, null, null, null, null, 'range', 17),
  ('property', 'carport', 'Carports', 'number', 'none', false, '{"type":"integer","minimum":0,"maximum":20}'::jsonb, null, null, null, null, null, 'range', 18),
  ('property', 'energy_features', 'Energy Features', 'checklist', 'closed', false, '{"maxItems":30,"type":"array","items":{"type":"string","maxLength":80,"enum":["solar_panels","inverter","generator","gas","prepaid_electricity","solar_geyser"]}}'::jsonb, '[{"value":"solar_panels","label":"Solar Panels"},{"value":"inverter","label":"Inverter"},{"value":"generator","label":"Generator"},{"value":"gas","label":"Gas"},{"value":"prepaid_electricity","label":"Prepaid Electricity"},{"value":"solar_geyser","label":"Solar Geyser"}]'::jsonb, null, null, null, null, 'contains', 19),
  ('property', 'water_source', 'Water Source', 'checklist', 'closed', false, '{"maxItems":30,"type":"array","items":{"type":"string","maxLength":80,"enum":["municipal","borehole","jojo_tank","rainwater_harvesting"]}}'::jsonb, '[{"value":"municipal","label":"Municipal"},{"value":"borehole","label":"Borehole"},{"value":"jojo_tank","label":"JoJo Tank"},{"value":"rainwater_harvesting","label":"Rainwater Harvesting"}]'::jsonb, null, null, null, null, 'contains', 20),
  ('property', 'fibre', 'Fibre Internet', 'select', 'closed', false, '{"type":"string","enum":["not_available","fibre_ready","fibre_installed"]}'::jsonb, '[{"value":"not_available","label":"Not Available"},{"value":"fibre_ready","label":"Fibre Ready"},{"value":"fibre_installed","label":"Fibre Installed"}]'::jsonb, null, null, null, null, 'choice', 21),
  ('property', 'available_from', 'Available From', 'text', 'none', false, '{"type":"string","maxLength":30,"format":"date"}'::jsonb, null, null, null, null, null, null, 22),
  ('vehicles', 'make', 'Make', 'combobox', 'suggestions', true, '{"type":"string","minLength":1,"maxLength":80}'::jsonb, '["Toyota","Volkswagen","Suzuki","Ford","Hyundai","Isuzu","Nissan","BMW","Mercedes-Benz","Audi","Kia","Renault","Honda","Mazda","Chery","GWM","Haval","Tank","Omoda","Jaecoo","Mahindra","Peugeot","Volvo","Jeep","Land Rover","TATA","Mitsubishi","Subaru","Opel","Fiat","Porsche","Mini","Lexus","JAC","BAIC","Other"]'::jsonb, null, null, null, null, null, 23),
  ('vehicles', 'model', 'Model', 'combobox', 'suggestions', true, '{"type":"string","minLength":1,"maxLength":80}'::jsonb, '[]'::jsonb, null, 'make', null, null, null, 24),
  ('vehicles', 'year', 'Year', 'number', 'none', true, '{"type":"integer","minimum":1950}'::jsonb, null, null, null, null, 'south_african_year_plus_one', 'range', 25),
  ('vehicles', 'mileage_km', 'Mileage', 'number', 'none', true, '{"type":"integer","minimum":0,"maximum":999999}'::jsonb, null, 'km', null, null, null, 'range', 26),
  ('vehicles', 'transmission', 'Transmission', 'select', 'closed', true, '{"type":"string","enum":["manual","automatic"]}'::jsonb, '[{"value":"manual","label":"Manual"},{"value":"automatic","label":"Automatic"}]'::jsonb, null, null, null, null, 'choice', 27),
  ('vehicles', 'fuel_type', 'Fuel Type', 'select', 'closed', true, '{"type":"string","enum":["petrol","diesel","electric","hybrid"]}'::jsonb, '[{"value":"petrol","label":"Petrol"},{"value":"diesel","label":"Diesel"},{"value":"electric","label":"Electric"},{"value":"hybrid","label":"Hybrid"}]'::jsonb, null, null, null, null, 'choice', 28),
  ('vehicles', 'body_type', 'Body Type', 'select', 'closed', false, '{"type":"string","enum":["hatchback","sedan","suv","bakkie","van","coupe","other"]}'::jsonb, '[{"value":"hatchback","label":"Hatchback"},{"value":"sedan","label":"Sedan"},{"value":"suv","label":"SUV"},{"value":"bakkie","label":"Bakkie"},{"value":"van","label":"Van"},{"value":"coupe","label":"Coupe"},{"value":"other","label":"Other"}]'::jsonb, null, null, null, null, 'choice', 29),
  ('vehicles', 'colour', 'Colour', 'combobox', 'suggestions', false, '{"type":"string","maxLength":30}'::jsonb, '[{"value":"White","label":"White"},{"value":"Black","label":"Black"},{"value":"Silver","label":"Silver"},{"value":"Grey","label":"Grey"},{"value":"Blue","label":"Blue"},{"value":"Red","label":"Red"},{"value":"Brown","label":"Brown"},{"value":"Gold","label":"Gold"},{"value":"Green","label":"Green"},{"value":"Orange","label":"Orange"},{"value":"Yellow","label":"Yellow"},{"value":"Maroon","label":"Maroon"},{"value":"Beige","label":"Beige"},{"value":"Other","label":"Other"}]'::jsonb, null, null, null, null, null, 30),
  ('vehicles', 'variant', 'Variant / Trim', 'text', 'none', false, '{"type":"string","maxLength":100}'::jsonb, null, null, null, null, null, null, 31),
  ('vehicles', 'engine_capacity_cc', 'Engine Size', 'number', 'none', false, '{"type":"integer","minimum":50,"maximum":10000}'::jsonb, null, 'cc', null, null, null, 'range', 32),
  ('vehicles', 'drive_type', 'Drive Type', 'select', 'closed', false, '{"type":"string","enum":["2wd","4wd","awd"]}'::jsonb, '[{"value":"2wd","label":"2WD"},{"value":"4wd","label":"4WD"},{"value":"awd","label":"AWD"}]'::jsonb, null, null, null, null, 'choice', 33),
  ('vehicles', 'number_of_doors', 'Doors', 'select', 'closed', false, '{"type":"string","enum":["2","3","4","5"]}'::jsonb, '[{"value":"2","label":"2"},{"value":"3","label":"3"},{"value":"4","label":"4"},{"value":"5","label":"5"}]'::jsonb, null, null, null, null, 'choice', 34),
  ('vehicles', 'service_history', 'Service History', 'select', 'closed', true, '{"type":"string","enum":["full","partial","none"]}'::jsonb, '[{"value":"full","label":"Full Service History"},{"value":"partial","label":"Partial Service History"},{"value":"none","label":"No Service History"}]'::jsonb, null, null, null, null, 'choice', 35),
  ('vehicles', 'number_of_owners', 'Previous Owners', 'number', 'none', false, '{"type":"integer","minimum":1,"maximum":20}'::jsonb, null, null, null, null, null, 'range', 36),
  ('vehicles', 'accident_free', 'Accident Free', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 37),
  ('vehicles', 'registration_province', 'Registration Province', 'combobox', 'suggestions', false, '{"type":"string","maxLength":30}'::jsonb, '[{"value":"EC","label":"Eastern Cape"},{"value":"FS","label":"Free State"},{"value":"GP","label":"Gauteng"},{"value":"KZN","label":"KwaZulu-Natal"},{"value":"LP","label":"Limpopo"},{"value":"MP","label":"Mpumalanga"},{"value":"NC","label":"Northern Cape"},{"value":"NW","label":"North West"},{"value":"WC","label":"Western Cape"}]'::jsonb, null, null, null, null, null, 38),
  ('vehicles', 'extras', 'Vehicle Extras', 'checklist', 'closed', false, '{"maxItems":30,"type":"array","items":{"type":"string","maxLength":80,"enum":["sunroof","leather_seats","towbar","canopy","roll_bar","nudge_bar","bull_bar","roof_rack","diff_lock","cruise_control","bluetooth","reverse_camera","parking_sensors","heated_seats","electric_windows","air_conditioning","sat_nav"]}}'::jsonb, '[{"value":"sunroof","label":"Sunroof"},{"value":"leather_seats","label":"Leather Seats"},{"value":"towbar","label":"Towbar"},{"value":"canopy","label":"Canopy"},{"value":"roll_bar","label":"Roll Bar"},{"value":"nudge_bar","label":"Nudge Bar"},{"value":"bull_bar","label":"Bull Bar"},{"value":"roof_rack","label":"Roof Rack"},{"value":"diff_lock","label":"Diff Lock"},{"value":"cruise_control","label":"Cruise Control"},{"value":"bluetooth","label":"Bluetooth"},{"value":"reverse_camera","label":"Reverse Camera"},{"value":"parking_sensors","label":"Parking Sensors"},{"value":"heated_seats","label":"Heated Seats"},{"value":"electric_windows","label":"Electric Windows"},{"value":"air_conditioning","label":"Air Conditioning"},{"value":"sat_nav","label":"Sat Nav / GPS"}]'::jsonb, null, null, null, null, 'contains', 39),
  ('vehicles', 'finance_available', 'Finance Available', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 40),
  ('vehicles', 'trade_in_accepted', 'Trade-In Accepted', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 41),
  ('auto_parts', 'part_type', 'Part Type', 'combobox', 'suggestions', true, '{"type":"string","minLength":1,"maxLength":100}'::jsonb, '["engine","body","electrical","suspension","brakes","wheels","interior","audio","tools","other"]'::jsonb, null, null, null, null, null, 42),
  ('auto_parts', 'compatible_make', 'Compatible Make(s)', 'text', 'none', false, '{"type":"string","maxLength":80}'::jsonb, null, null, null, null, null, null, 43),
  ('auto_parts', 'compatible_model', 'Compatible Model(s)', 'text', 'none', false, '{"type":"string","maxLength":80}'::jsonb, null, null, null, null, null, null, 44),
  ('auto_parts', 'oem_or_aftermarket', 'OEM or Aftermarket', 'select', 'closed', false, '{"type":"string","enum":["oem","aftermarket"]}'::jsonb, '[{"value":"oem","label":"OEM"},{"value":"aftermarket","label":"Aftermarket"}]'::jsonb, null, null, null, null, 'choice', 45),
  ('auto_parts', 'part_condition', 'Condition', 'select', 'closed', true, '{"type":"string","enum":["new","used","refurbished"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"used","label":"Used"},{"value":"refurbished","label":"Refurbished"}]'::jsonb, null, null, null, null, 'choice', 46),
  ('auto_parts', 'warranty_included', 'Warranty Included', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 47),
  ('auto_parts', 'fitment_included', 'Fitment / Installation Included', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 48),
  ('auto_parts', 'compatible_year_range', 'Compatible Year Range', 'text', 'none', false, '{"type":"string","maxLength":30}'::jsonb, null, null, null, null, null, null, 49),
  ('electronics', 'device_type', 'Device Type', 'select', 'closed', true, '{"type":"string","enum":["Smartphone","Tablet / iPad","Laptop","Desktop PC","Gaming Console","Video Games","Monitors & TVs","PC Components","Smartwatch / Wearable","Audio & Headphones","Cameras & Drones","Accessories"]}'::jsonb, '["Smartphone","Tablet / iPad","Laptop","Desktop PC","Gaming Console","Video Games","Monitors & TVs","PC Components","Smartwatch / Wearable","Audio & Headphones","Cameras & Drones","Accessories"]'::jsonb, null, null, null, null, 'choice', 50),
  ('electronics', 'brand', 'Brand', 'text', 'none', true, '{"type":"string","minLength":1,"maxLength":80}'::jsonb, null, null, null, null, null, null, 51),
  ('electronics', 'model_name', 'Model', 'text', 'none', false, '{"type":"string","maxLength":100}'::jsonb, null, null, null, null, null, null, 52),
  ('electronics', 'storage_gb', 'Storage Capacity', 'number', 'none', false, '{"type":"integer","minimum":1,"maximum":1000000000}'::jsonb, null, 'GB', null, null, null, 'range', 53),
  ('electronics', 'screen_size_inches', 'Screen Size', 'number', 'none', false, '{"type":"number","minimum":1,"maximum":100}'::jsonb, null, 'in', null, null, null, 'range', 54),
  ('electronics', 'warranty_months', 'Warranty', 'number', 'none', false, '{"type":"integer","minimum":0,"maximum":1000000000}'::jsonb, null, 'months', null, null, null, 'range', 55),
  ('electronics', 'network_lock', 'Network Lock', 'select', 'closed', false, '{"type":"string","enum":["unlocked","vodacom","mtn","cell_c","telkom","rain"]}'::jsonb, '[{"value":"unlocked","label":"Unlocked"},{"value":"vodacom","label":"Vodacom"},{"value":"mtn","label":"MTN"},{"value":"cell_c","label":"Cell C"},{"value":"telkom","label":"Telkom"},{"value":"rain","label":"Rain"}]'::jsonb, null, null, null, null, 'choice', 56),
  ('electronics', 'battery_health_pct', 'Battery Health', 'number', 'none', false, '{"type":"integer","minimum":0,"maximum":100}'::jsonb, null, '%', null, null, null, 'range', 57),
  ('electronics', 'ram_gb', 'RAM', 'number', 'none', false, '{"type":"integer","minimum":1,"maximum":256}'::jsonb, null, 'GB', null, null, null, 'range', 58),
  ('electronics', 'original_accessories', 'Original Accessories Included', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 59),
  ('electronics', 'activation_lock_clear', 'Activation Lock Cleared', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 60),
  ('home_lifestyle', 'sub_category', 'Item type', 'select', 'closed', true, '{"type":"string","enum":["furniture","appliances","garden","decor","tools_equipment"]}'::jsonb, '[{"value":"furniture","label":"Furniture & Decor"},{"value":"appliances","label":"Home Appliances"},{"value":"garden","label":"Garden & Outdoor"},{"value":"decor","label":"Decor"},{"value":"tools_equipment","label":"Tools & Equipment"}]'::jsonb, null, null, null, null, 'choice', 61),
  ('home_lifestyle', 'material', 'Material', 'combobox', 'suggestions', false, '{"type":"string","maxLength":50}'::jsonb, '[{"value":"Wood","label":"Wood"},{"value":"Leather","label":"Leather"},{"value":"Fabric","label":"Fabric"},{"value":"Metal","label":"Metal"},{"value":"Glass","label":"Glass"},{"value":"Plastic","label":"Plastic"},{"value":"Cotton","label":"Cotton"},{"value":"Ceramic","label":"Ceramic"},{"value":"Stone","label":"Stone"},{"value":"Other","label":"Other"}]'::jsonb, null, null, null, null, null, 62),
  ('home_lifestyle', 'brand', 'Brand', 'text', 'none', false, '{"type":"string","maxLength":80}'::jsonb, null, null, null, null, null, null, 63),
  ('home_lifestyle', 'dimensions', 'Dimensions', 'text', 'none', false, '{"type":"string","maxLength":60}'::jsonb, null, null, null, null, null, null, 64),
  ('home_lifestyle', 'delivery_available', 'Delivery Available', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 65),
  ('home_lifestyle', 'power_rating', 'Power Rating', 'text', 'none', false, '{"type":"string","maxLength":30}'::jsonb, null, null, null, null, null, null, 66),
  ('jobs_services', 'job_type', 'Job type', 'select', 'closed', true, '{"type":"string","enum":["full_time","part_time","contract","freelance","internship","learnership","volunteer"]}'::jsonb, '[{"value":"full_time","label":"Full Time"},{"value":"part_time","label":"Part Time"},{"value":"contract","label":"Contract"},{"value":"freelance","label":"Freelance"},{"value":"internship","label":"Internship"},{"value":"learnership","label":"Learnership"},{"value":"volunteer","label":"Volunteer"}]'::jsonb, null, null, null, null, 'choice', 67),
  ('jobs_services', 'location_type', 'Location Type', 'select', 'closed', true, '{"type":"string","enum":["remote","hybrid","on_site"]}'::jsonb, '[{"value":"remote","label":"Remote"},{"value":"hybrid","label":"Hybrid"},{"value":"on_site","label":"On-Site"}]'::jsonb, null, null, null, null, 'choice', 68),
  ('jobs_services', 'industry', 'Industry', 'combobox', 'suggestions', false, '{"type":"string","maxLength":80}'::jsonb, '[{"value":"mining","label":"Mining"},{"value":"construction","label":"Construction"},{"value":"retail","label":"Retail"},{"value":"hospitality","label":"Hospitality"},{"value":"IT","label":"IT & Tech"},{"value":"finance","label":"Finance"},{"value":"healthcare","label":"Healthcare"},{"value":"education","label":"Education"},{"value":"agriculture","label":"Agriculture"},{"value":"manufacturing","label":"Manufacturing"},{"value":"logistics","label":"Logistics & Transport"},{"value":"government","label":"Government"},{"value":"legal","label":"Legal"},{"value":"media","label":"Media & Marketing"},{"value":"security","label":"Security"},{"value":"other","label":"Other"}]'::jsonb, null, null, null, null, null, 69),
  ('jobs_services', 'experience_level', 'Experience Level', 'select', 'closed', false, '{"type":"string","enum":["entry_level","junior","mid_level","senior","executive"]}'::jsonb, '[{"value":"entry_level","label":"Entry Level"},{"value":"junior","label":"Junior"},{"value":"mid_level","label":"Mid Level"},{"value":"senior","label":"Senior"},{"value":"executive","label":"Executive"}]'::jsonb, null, null, null, null, 'choice', 70),
  ('jobs_services', 'qualification_required', 'Qualification Required', 'select', 'closed', false, '{"type":"string","enum":["none","matric","certificate","diploma","degree","postgraduate"]}'::jsonb, '[{"value":"none","label":"None"},{"value":"matric","label":"Matric"},{"value":"certificate","label":"Certificate"},{"value":"diploma","label":"Diploma"},{"value":"degree","label":"Degree"},{"value":"postgraduate","label":"Postgraduate"}]'::jsonb, null, null, null, null, 'choice', 71),
  ('jobs_services', 'salary_period', 'Salary Period', 'select', 'closed', false, '{"type":"string","enum":["per_hour","per_day","per_month","per_year"]}'::jsonb, '[{"value":"per_hour","label":"Per Hour"},{"value":"per_day","label":"Per Day"},{"value":"per_month","label":"Per Month"},{"value":"per_year","label":"Per Year"}]'::jsonb, null, null, null, null, 'choice', 72),
  ('jobs_services', 'company_name', 'Company Name', 'text', 'none', false, '{"type":"string","maxLength":120}'::jsonb, null, null, null, null, null, null, 73),
  ('jobs_services', 'benefits', 'Benefits', 'checklist', 'closed', false, '{"maxItems":30,"type":"array","items":{"type":"string","maxLength":80,"enum":["medical_aid","provident_fund","pension","thirteenth_cheque","annual_bonus","travel_allowance","housing_allowance","cell_phone_allowance"]}}'::jsonb, '[{"value":"medical_aid","label":"Medical Aid"},{"value":"provident_fund","label":"Provident Fund"},{"value":"pension","label":"Pension"},{"value":"thirteenth_cheque","label":"13th Cheque"},{"value":"annual_bonus","label":"Annual Bonus"},{"value":"travel_allowance","label":"Travel Allowance"},{"value":"housing_allowance","label":"Housing Allowance"},{"value":"cell_phone_allowance","label":"Cell Phone Allowance"}]'::jsonb, null, null, null, null, 'contains', 74),
  ('jobs_services', 'ee_preference', 'Employment Equity', 'select', 'closed', false, '{"type":"string","enum":["not_applicable","aa_candidates_preferred","open_to_all"]}'::jsonb, '[{"value":"not_applicable","label":"Not Applicable"},{"value":"aa_candidates_preferred","label":"AA Candidates Preferred"},{"value":"open_to_all","label":"Open to All"}]'::jsonb, null, null, null, null, 'choice', 75),
  ('jobs_services', 'application_deadline', 'Application Deadline', 'text', 'none', false, '{"type":"string","maxLength":30,"format":"date"}'::jsonb, null, null, null, null, null, null, 76),
  ('farming_agriculture', 'farm_category', 'Farm Category', 'select', 'closed', true, '{"type":"string","enum":["livestock","crops_seeds","equipment_machinery","farm_land","feeds_supplements","farming_services","other"]}'::jsonb, '[{"value":"livestock","label":"Livestock"},{"value":"crops_seeds","label":"Crops & Seeds"},{"value":"equipment_machinery","label":"Equipment & Machinery"},{"value":"farm_land","label":"Farm Land"},{"value":"feeds_supplements","label":"Feeds & Supplements"},{"value":"farming_services","label":"Farming Services"},{"value":"other","label":"Other"}]'::jsonb, null, null, null, null, 'choice', 77),
  ('farming_agriculture', 'livestock_type', 'Livestock Type', 'select', 'closed', false, '{"type":"string","enum":["cattle","sheep","goats","poultry","pigs","horses","game","other"]}'::jsonb, '[{"value":"cattle","label":"Cattle"},{"value":"sheep","label":"Sheep"},{"value":"goats","label":"Goats"},{"value":"poultry","label":"Poultry"},{"value":"pigs","label":"Pigs"},{"value":"horses","label":"Horses"},{"value":"game","label":"Game"},{"value":"other","label":"Other"}]'::jsonb, null, 'farm_category', '["livestock"]'::jsonb, null, 'choice', 78),
  ('farming_agriculture', 'breed', 'Breed', 'text', 'none', false, '{"type":"string","maxLength":80}'::jsonb, null, null, 'farm_category', '["livestock"]'::jsonb, null, null, 79),
  ('farming_agriculture', 'age_months', 'Age', 'number', 'none', false, '{"type":"integer","minimum":0,"maximum":1000000000}'::jsonb, null, 'months', 'farm_category', '["livestock"]'::jsonb, null, 'range', 80),
  ('farming_agriculture', 'quantity', 'Quantity Available', 'number', 'none', false, '{"type":"integer","minimum":1,"maximum":1000000000}'::jsonb, null, null, null, null, null, 'range', 81),
  ('farming_agriculture', 'equipment_condition', 'Equipment Condition', 'select', 'closed', false, '{"type":"string","enum":["new","used","refurbished"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"used","label":"Used"},{"value":"refurbished","label":"Refurbished"}]'::jsonb, null, 'farm_category', '["equipment_machinery"]'::jsonb, null, 'choice', 82),
  ('farming_agriculture', 'hectares', 'Farm Size', 'number', 'none', false, '{"type":"number","minimum":0,"maximum":1000000000}'::jsonb, null, 'ha', 'farm_category', '["farm_land"]'::jsonb, null, 'range', 83),
  ('farming_agriculture', 'irrigation', 'Irrigation', 'select', 'closed', false, '{"type":"string","enum":["none","drip","sprinkler","pivot","flood"]}'::jsonb, '[{"value":"none","label":"None"},{"value":"drip","label":"Drip"},{"value":"sprinkler","label":"Sprinkler"},{"value":"pivot","label":"Pivot"},{"value":"flood","label":"Flood"}]'::jsonb, null, 'farm_category', '["farm_land","crops_seeds"]'::jsonb, null, 'choice', 84),
  ('farming_agriculture', 'delivery_available', 'Delivery Available', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 85),
  ('baby_kids', 'item_type', 'Item Type', 'select', 'closed', true, '{"type":"string","enum":["clothing","toys","prams_strollers","car_seats","feeding","nursery_furniture","maternity","school_supplies","other"]}'::jsonb, '[{"value":"clothing","label":"Clothing"},{"value":"toys","label":"Toys"},{"value":"prams_strollers","label":"Prams & Strollers"},{"value":"car_seats","label":"Car Seats"},{"value":"feeding","label":"Feeding"},{"value":"nursery_furniture","label":"Nursery Furniture"},{"value":"maternity","label":"Maternity"},{"value":"school_supplies","label":"School Supplies"},{"value":"other","label":"Other"}]'::jsonb, null, null, null, null, 'choice', 86),
  ('baby_kids', 'age_group', 'Age Group', 'select', 'closed', false, '{"type":"string","enum":["newborn_0_3m","infant_3_12m","toddler_1_3y","preschool_3_6y","school_age_6_12y","teen_12_plus"]}'::jsonb, '[{"value":"newborn_0_3m","label":"Newborn (0-3 months)"},{"value":"infant_3_12m","label":"Infant (3-12 months)"},{"value":"toddler_1_3y","label":"Toddler (1-3 years)"},{"value":"preschool_3_6y","label":"Preschool (3-6 years)"},{"value":"school_age_6_12y","label":"School Age (6-12 years)"},{"value":"teen_12_plus","label":"Teen (12+)"}]'::jsonb, null, null, null, null, 'choice', 87),
  ('baby_kids', 'gender', 'Gender', 'select', 'closed', false, '{"type":"string","enum":["unisex","boys","girls"]}'::jsonb, '[{"value":"unisex","label":"Unisex"},{"value":"boys","label":"Boys"},{"value":"girls","label":"Girls"}]'::jsonb, null, null, null, null, 'choice', 88),
  ('baby_kids', 'brand', 'Brand', 'text', 'none', false, '{"type":"string","maxLength":80}'::jsonb, null, null, null, null, null, null, 89),
  ('baby_kids', 'safety_certified', 'Safety Certified (SABS)', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 90),
  ('clothing_accessories', 'material', 'Material', 'combobox', 'suggestions', false, '{"type":"string","maxLength":50}'::jsonb, '[{"value":"Wood","label":"Wood"},{"value":"Leather","label":"Leather"},{"value":"Fabric","label":"Fabric"},{"value":"Metal","label":"Metal"},{"value":"Glass","label":"Glass"},{"value":"Plastic","label":"Plastic"},{"value":"Cotton","label":"Cotton"},{"value":"Ceramic","label":"Ceramic"},{"value":"Stone","label":"Stone"},{"value":"Other","label":"Other"}]'::jsonb, null, null, null, null, null, 91),
  ('clothing_accessories', 'brand', 'Brand', 'text', 'none', false, '{"type":"string","maxLength":80}'::jsonb, null, null, null, null, null, null, 92),
  ('clothing_accessories', 'dimensions', 'Dimensions', 'text', 'none', false, '{"type":"string","maxLength":60}'::jsonb, null, null, null, null, null, null, 93),
  ('clothing_accessories', 'delivery_available', 'Delivery Available', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 94),
  ('sports_hobbies', 'sub_category', 'Item type', 'select', 'closed', false, '{"type":"string","enum":["sports_outdoor","musical_instruments","books_stationery"]}'::jsonb, '[{"value":"sports_outdoor","label":"Sports & Outdoor"},{"value":"musical_instruments","label":"Musical Instruments"},{"value":"books_stationery","label":"Books & Stationery"}]'::jsonb, null, null, null, null, 'choice', 95),
  ('sports_hobbies', 'material', 'Material', 'combobox', 'suggestions', false, '{"type":"string","maxLength":50}'::jsonb, '[{"value":"Wood","label":"Wood"},{"value":"Leather","label":"Leather"},{"value":"Fabric","label":"Fabric"},{"value":"Metal","label":"Metal"},{"value":"Glass","label":"Glass"},{"value":"Plastic","label":"Plastic"},{"value":"Cotton","label":"Cotton"},{"value":"Ceramic","label":"Ceramic"},{"value":"Stone","label":"Stone"},{"value":"Other","label":"Other"}]'::jsonb, null, null, null, null, null, 96),
  ('sports_hobbies', 'brand', 'Brand', 'text', 'none', false, '{"type":"string","maxLength":80}'::jsonb, null, null, null, null, null, null, 97),
  ('sports_hobbies', 'dimensions', 'Dimensions', 'text', 'none', false, '{"type":"string","maxLength":60}'::jsonb, null, null, null, null, null, null, 98),
  ('sports_hobbies', 'delivery_available', 'Delivery Available', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 99),
  ('other_items', 'material', 'Material', 'combobox', 'suggestions', false, '{"type":"string","maxLength":50}'::jsonb, '[{"value":"Wood","label":"Wood"},{"value":"Leather","label":"Leather"},{"value":"Fabric","label":"Fabric"},{"value":"Metal","label":"Metal"},{"value":"Glass","label":"Glass"},{"value":"Plastic","label":"Plastic"},{"value":"Cotton","label":"Cotton"},{"value":"Ceramic","label":"Ceramic"},{"value":"Stone","label":"Stone"},{"value":"Other","label":"Other"}]'::jsonb, null, null, null, null, null, 100),
  ('other_items', 'brand', 'Brand', 'text', 'none', false, '{"type":"string","maxLength":80}'::jsonb, null, null, null, null, null, null, 101),
  ('other_items', 'dimensions', 'Dimensions', 'text', 'none', false, '{"type":"string","maxLength":60}'::jsonb, null, null, null, null, null, null, 102),
  ('other_items', 'delivery_available', 'Delivery Available', 'boolean', 'none', false, '{"type":"boolean"}'::jsonb, null, null, null, null, null, 'boolean', 103),
  ('property', 'condition', 'Condition', 'select', 'closed', false, '{"type":"string","enum":["new","like_new","good","fair","for_parts"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"like_new","label":"Like new"},{"value":"good","label":"Good"},{"value":"fair","label":"Fair"},{"value":"for_parts","label":"For parts"}]'::jsonb, null, null, null, null, 'choice', 104),
  ('vehicles', 'condition', 'Condition', 'select', 'closed', false, '{"type":"string","enum":["new","like_new","good","fair","for_parts"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"like_new","label":"Like new"},{"value":"good","label":"Good"},{"value":"fair","label":"Fair"},{"value":"for_parts","label":"For parts"}]'::jsonb, null, null, null, null, 'choice', 105),
  ('auto_parts', 'condition', 'Condition', 'select', 'closed', false, '{"type":"string","enum":["new","like_new","good","fair","for_parts"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"like_new","label":"Like new"},{"value":"good","label":"Good"},{"value":"fair","label":"Fair"},{"value":"for_parts","label":"For parts"}]'::jsonb, null, null, null, null, 'choice', 106),
  ('electronics', 'condition', 'Condition', 'select', 'closed', false, '{"type":"string","enum":["new","like_new","good","fair","for_parts"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"like_new","label":"Like new"},{"value":"good","label":"Good"},{"value":"fair","label":"Fair"},{"value":"for_parts","label":"For parts"}]'::jsonb, null, null, null, null, 'choice', 107),
  ('home_lifestyle', 'condition', 'Condition', 'select', 'closed', false, '{"type":"string","enum":["new","like_new","good","fair","for_parts"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"like_new","label":"Like new"},{"value":"good","label":"Good"},{"value":"fair","label":"Fair"},{"value":"for_parts","label":"For parts"}]'::jsonb, null, null, null, null, 'choice', 108),
  ('farming_agriculture', 'condition', 'Condition', 'select', 'closed', false, '{"type":"string","enum":["new","like_new","good","fair","for_parts"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"like_new","label":"Like new"},{"value":"good","label":"Good"},{"value":"fair","label":"Fair"},{"value":"for_parts","label":"For parts"}]'::jsonb, null, null, null, null, 'choice', 109),
  ('baby_kids', 'condition', 'Condition', 'select', 'closed', false, '{"type":"string","enum":["new","like_new","good","fair","for_parts"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"like_new","label":"Like new"},{"value":"good","label":"Good"},{"value":"fair","label":"Fair"},{"value":"for_parts","label":"For parts"}]'::jsonb, null, null, null, null, 'choice', 110),
  ('clothing_accessories', 'condition', 'Condition', 'select', 'closed', false, '{"type":"string","enum":["new","like_new","good","fair","for_parts"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"like_new","label":"Like new"},{"value":"good","label":"Good"},{"value":"fair","label":"Fair"},{"value":"for_parts","label":"For parts"}]'::jsonb, null, null, null, null, 'choice', 111),
  ('sports_hobbies', 'condition', 'Condition', 'select', 'closed', false, '{"type":"string","enum":["new","like_new","good","fair","for_parts"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"like_new","label":"Like new"},{"value":"good","label":"Good"},{"value":"fair","label":"Fair"},{"value":"for_parts","label":"For parts"}]'::jsonb, null, null, null, null, 'choice', 112),
  ('other_items', 'condition', 'Condition', 'select', 'closed', false, '{"type":"string","enum":["new","like_new","good","fair","for_parts"]}'::jsonb, '[{"value":"new","label":"New"},{"value":"like_new","label":"Like new"},{"value":"good","label":"Good"},{"value":"fair","label":"Fair"},{"value":"for_parts","label":"For parts"}]'::jsonb, null, null, null, null, 'choice', 113);

-- Source: docs/backend-foundation/prototypes/post-search.sql
-- BF-06 public catalogue and database-side search candidate. Runs after the
-- generated reference seeds. The search projection is written only by the
-- publication transaction (BF-05); browsers read it through api functions.

-- Real catalogue categories become valid post contracts beside the synthetic
-- fixture categories used by earlier identity tests.
insert into private.post_category_contracts (category_key, kind, area)
select c.key, c.kind, c.area from private.categories c
on conflict do nothing;

grant usage on schema internal to anon;
create extension if not exists pg_trgm with schema extensions;

create function internal.reference_catalog()
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'version', v.version,
    'content_hash', v.content_hash,
    'categories', (select jsonb_agg(jsonb_build_object('key', c.key, 'kind', c.kind, 'area', c.area,
        'label', c.label, 'activity_required', c.activity_required) order by c.sort_order)
      from private.categories c where c.reference_version = v.version),
    'activities', (select jsonb_agg(jsonb_build_object('category', a.category_key, 'key', a.key,
        'label', a.label, 'field_group', a.field_group) order by a.sort_order)
      from private.category_activities a),
    'provinces', (select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'label', p.label)
        order by p.sort_order) from private.provinces p),
    'cities', (select jsonb_agg(jsonb_build_object('id', c.id, 'province', c.province_id, 'label', c.label)
        order by c.sort_order) from private.cities c),
    'fields', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('category', f.category_key,
        'key', f.key, 'label', f.label, 'renderer', f.renderer, 'required', f.required,
        'options', f.options, 'unit', f.unit, 'facet', f.facet_kind)) order by f.sort_order)
      from private.category_fields f)
  )
  from private.reference_catalog_versions v
  order by v.version desc limit 1;
$$;
revoke all on function internal.reference_catalog() from public, anon, authenticated, service_role;
grant execute on function internal.reference_catalog() to anon, authenticated;
create function api.reference_catalog()
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.reference_catalog();
$$;
revoke all on function api.reference_catalog() from public, anon, authenticated, service_role;
grant execute on function api.reference_catalog() to anon, authenticated;

-- One row per published post. Display-safe columns only: no contacts, owner or
-- moderation data. visible_until enforces expiry at read time without a job.
create table private.post_search_documents (
  post_id uuid primary key references private.posts (id) on delete cascade,
  kind text not null check (kind in ('listing', 'business', 'event')),
  area text not null check (area in ('market', 'business', 'tourism_events')),
  category_key text not null references private.categories (key),
  activity_key text,
  province_id text not null references private.provinces (id),
  city_id text,
  locality_label text not null check (length(locality_label) between 1 and 120),
  title text not null check (length(title) between 1 and 120),
  summary text not null default '' check (length(summary) <= 300),
  price_mode text check (price_mode in ('amount', 'free', 'on_request')),
  price_cents bigint check (price_cents is null or price_cents between 0 and 100000000000),
  published_at timestamptz not null,
  visible_until timestamptz,
  is_visible boolean not null,
  facets jsonb not null default '{}' check (jsonb_typeof(facets) = 'object'),
  search_text text not null default '',
  document tsvector not null,
  foreign key (category_key, kind, area) references private.categories (key, kind, area),
  foreign key (category_key, activity_key) references private.category_activities (category_key, key),
  foreign key (city_id, province_id) references private.cities (id, province_id),
  check ((price_mode is null and price_cents is null)
    or (price_mode = 'amount' and price_cents > 0)
    or (price_mode = 'free' and price_cents = 0)
    or (price_mode = 'on_request' and price_cents is null))
);
create index post_search_recent_idx on private.post_search_documents (published_at desc, post_id desc) where is_visible;
create index post_search_area_idx on private.post_search_documents (area, published_at desc, post_id desc) where is_visible;
create index post_search_category_idx on private.post_search_documents (category_key, published_at desc, post_id desc) where is_visible;
create index post_search_locality_idx on private.post_search_documents (province_id, city_id) where is_visible;
create index post_search_document_idx on private.post_search_documents using gin (document) where is_visible;
create index post_search_facets_idx on private.post_search_documents using gin (facets jsonb_path_ops) where is_visible;
create index post_search_trigram_idx on private.post_search_documents
  using gin (search_text extensions.gin_trgm_ops) where is_visible;
alter table private.post_search_documents enable row level security;
revoke all on private.post_search_documents from public, anon, authenticated, service_role;

-- Weighted document: title A, category/activity/locality B, summary C. Labels
-- are read here, inside the writer's transaction, because a generated column
-- cannot join reference tables.
create function internal.post_search_document(p_title text, p_summary text, p_category text,
  p_activity text, p_locality text)
returns tsvector language sql stable security invoker set search_path = pg_catalog as $$
  select setweight(to_tsvector('simple', coalesce(p_title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce((select c.label from private.categories c where c.key = p_category), '')
      || ' ' || coalesce((select a.label from private.category_activities a
        where a.category_key = p_category and a.key = p_activity), '')
      || ' ' || coalesce(p_locality, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(p_summary, '')), 'C');
$$;
revoke all on function internal.post_search_document(text, text, text, text, text)
  from public, anon, authenticated, service_role;

create function internal.post_search_document_refresh()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  new.document := internal.post_search_document(new.title, new.summary, new.category_key,
    new.activity_key, new.locality_label);
  -- Plain lower-case text for typo-tolerant trigram matching.
  new.search_text := lower(normalize(concat_ws(' ', new.title,
    (select c.label from private.categories c where c.key = new.category_key),
    (select a.label from private.category_activities a
      where a.category_key = new.category_key and a.key = new.activity_key),
    new.locality_label, new.summary), NFKC));
  return new;
end;
$$;
revoke all on function internal.post_search_document_refresh() from public, anon, authenticated, service_role;
create trigger post_search_document_refresh before insert or update of title, summary, category_key,
  activity_key, locality_label on private.post_search_documents
  for each row execute function internal.post_search_document_refresh();

-- Search contract (owner decision DEC-23: the standard used by major platforms):
--  * request keys are an allowlist; unknown keys, oversized values and wrong types fail with 22023;
--  * q: NFKC, lower case, letters/digits only, at most 8 terms of <= 40 chars. Every term must
--    match (AND), either as a word prefix or, for terms of 4+ characters, by trigram word
--    similarity >= 0.5 so ordinary typos still find results;
--  * sort: 'relevance' (default with q) ranks text relevance (75%) blended with freshness
--    (25%, 30-day decay); 'newest' (default without q) orders by publication time. Post id is
--    the final tie-breaker, so keyset cursors never skip or repeat;
--  * the first page pins an as-of time carried in the cursor: later pages rank against the
--    same clock and exclude posts published after it, so paging stays stable;
--  * attributes require one category and use that category's facet registry only;
--  * promoted placement is a separate slot, never interleaved into this cursor;
--  * total and category facets use the same predicates as the rows; category facets ignore
--    the category filter itself so other categories stay discoverable.
create function internal.search_posts(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare
  req jsonb := coalesce(p_request, '{}');
  allowed text[] := array['q', 'sort', 'area', 'category', 'activity', 'province', 'city', 'price_mode',
    'min_price_cents', 'max_price_cents', 'condition', 'attributes', 'cursor', 'limit'];
  v_sort text;
  v_asof timestamptz := statement_timestamp();
  v_after_score numeric;
  v_limit integer := 24;
  v_q text;
  v_terms text[];
  v_tsquery tsquery;
  v_area text;
  v_category text;
  v_activity text;
  v_province text;
  v_city text;
  v_price_mode text;
  v_condition text;
  v_min bigint;
  v_max bigint;
  v_attrs jsonb := '{}';
  v_contains jsonb := '{}';
  v_ranges jsonb := '[]';
  v_signature text;
  v_cursor jsonb;
  v_after_at timestamptz;
  v_after_id uuid;
  f record;
  attr record;
  v_items jsonb;
  v_total bigint;
  v_facets jsonb;
  v_has_more boolean;
begin
  if jsonb_typeof(req) <> 'object' or octet_length(req::text) > 4096 then
    raise exception 'invalid search request' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(req) k where k <> all (allowed)) then
    raise exception 'unknown search filter' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(req) e where e.key not in ('attributes', 'limit', 'min_price_cents', 'max_price_cents')
      and jsonb_typeof(e.value) <> 'string') then
    raise exception 'search filters must be strings' using errcode = '22023';
  end if;

  if req ? 'limit' then
    if jsonb_typeof(req->'limit') <> 'number' or (req->>'limit') !~ '^[0-9]{1,2}$'
      or (req->>'limit')::integer not between 1 and 48 then
      raise exception 'limit must be 1 to 48' using errcode = '22023';
    end if;
    v_limit := (req->>'limit')::integer;
  end if;

  if req ? 'q' then
    v_q := lower(normalize(req->>'q', NFKC));
    if length(v_q) > 200 then raise exception 'query too long' using errcode = '22023'; end if;
    select array_agg(m[1]) into v_terms from regexp_matches(v_q, '([[:alnum:]]+)', 'g') m;
    if coalesce(cardinality(v_terms), 0) > 8 or exists (select 1 from unnest(v_terms) t where length(t) > 40) then
      raise exception 'too many or too long search terms' using errcode = '22023';
    end if;
    if coalesce(cardinality(v_terms), 0) > 0 then
      -- Any-term query used only for ranking; matching requires every term.
      v_tsquery := to_tsquery('simple', array_to_string(array(select t || ':*' from unnest(v_terms) t), ' | '));
    else
      v_terms := null;
    end if;
  end if;
  v_sort := coalesce(req->>'sort', case when v_terms is null then 'newest' else 'relevance' end);
  if v_sort not in ('relevance', 'newest') or (v_sort = 'relevance' and v_terms is null) then
    raise exception 'sort must be relevance (with a query) or newest' using errcode = '22023';
  end if;

  v_area := req->>'area';
  if v_area is not null and v_area not in ('market', 'business', 'tourism_events') then
    raise exception 'unknown area' using errcode = '22023';
  end if;
  v_category := req->>'category';
  if v_category is not null and not exists (select 1 from private.categories c where c.key = v_category
      and (v_area is null or c.area = v_area)) then
    raise exception 'unknown category for this area' using errcode = '22023';
  end if;
  v_activity := req->>'activity';
  if v_activity is not null and (v_category is null or not exists (select 1 from private.category_activities a
      where a.category_key = v_category and a.key = v_activity)) then
    raise exception 'activity requires its category' using errcode = '22023';
  end if;
  v_province := req->>'province';
  if v_province is not null and not exists (select 1 from private.provinces p where p.id = v_province) then
    raise exception 'unknown province' using errcode = '22023';
  end if;
  v_city := req->>'city';
  if v_city is not null and (v_province is null or not exists (select 1 from private.cities c
      where c.id = v_city and c.province_id = v_province)) then
    raise exception 'city requires its province' using errcode = '22023';
  end if;
  v_price_mode := req->>'price_mode';
  v_condition := req->>'condition';
  if v_condition is not null and v_condition not in ('new','like_new','good','fair','for_parts') then
    raise exception 'unknown listing condition' using errcode='22023';
  end if;
  if v_price_mode is not null and v_price_mode not in ('amount', 'free', 'on_request') then
    raise exception 'unknown price mode' using errcode = '22023';
  end if;
  for f in select k, req->k as v from unnest(array['min_price_cents', 'max_price_cents']) k where req ? k loop
    if jsonb_typeof(f.v) <> 'number' or (f.v #>> '{}') !~ '^[0-9]{1,12}$' then
      raise exception 'price bounds must be whole cents' using errcode = '22023';
    end if;
  end loop;
  v_min := (req->>'min_price_cents')::bigint;
  v_max := (req->>'max_price_cents')::bigint;
  if (v_min is not null or v_max is not null) then
    if v_price_mode is distinct from 'amount' then
      raise exception 'price ranges apply to amount prices only' using errcode = '22023';
    end if;
    if v_min > v_max then raise exception 'minimum exceeds maximum' using errcode = '22023'; end if;
  end if;

  if req ? 'attributes' then
    v_attrs := req->'attributes';
    if jsonb_typeof(v_attrs) <> 'object' then raise exception 'attributes must be an object' using errcode = '22023'; end if;
    if v_attrs <> '{}' and v_category is null then
      raise exception 'attribute filters require a category' using errcode = '22023';
    end if;
    if v_condition is not null and v_attrs ? 'condition'
      and v_attrs->>'condition' is distinct from v_condition then
      raise exception 'conflicting condition filters' using errcode='22023';
    end if;
    for attr in select e.key, e.value from jsonb_each(v_attrs) e loop
      select cf.* into f from private.category_fields cf
        where cf.category_key = v_category and cf.key = attr.key and cf.facet_kind is not null;
      if not found then raise exception 'unknown attribute filter' using errcode = '22023'; end if;
      if f.facet_kind = 'boolean' then
        if jsonb_typeof(attr.value) <> 'boolean' then raise exception 'boolean filter expected' using errcode = '22023'; end if;
        v_contains := v_contains || jsonb_build_object(attr.key, attr.value);
      elsif f.facet_kind in ('choice', 'contains') then
        if jsonb_typeof(attr.value) <> 'string' or not coalesce(f.validation->'enum' ? (attr.value #>> '{}')
            or f.validation->'items'->'enum' ? (attr.value #>> '{}'), false) then
          raise exception 'unknown attribute choice' using errcode = '22023';
        end if;
        v_contains := v_contains || jsonb_build_object(attr.key,
          case when f.facet_kind = 'contains' then jsonb_build_array(attr.value) else attr.value end);
      else
        if jsonb_typeof(attr.value) <> 'object' or exists (select 1 from jsonb_object_keys(attr.value) k where k not in ('min', 'max'))
          or exists (select 1 from jsonb_each(attr.value) b where jsonb_typeof(b.value) <> 'number')
          or (attr.value->>'min')::numeric > (attr.value->>'max')::numeric then
          raise exception 'range filter expected' using errcode = '22023';
        end if;
        v_ranges := v_ranges || jsonb_build_array(jsonb_build_object('key', attr.key,
          'min', attr.value->'min', 'max', attr.value->'max'));
      end if;
    end loop;
  end if;

  -- The cursor is bound to every filter so a page can never continue a different query.
  v_signature := md5((req - 'cursor' - 'limit')::text);
  if req ? 'cursor' then
    begin
      v_cursor := convert_from(decode(translate(req->>'cursor', '-_', '+/'), 'base64'), 'UTF8')::jsonb;
      v_after_at := (v_cursor->>'at')::timestamptz;
      v_after_id := (v_cursor->>'id')::uuid;
      v_asof := (v_cursor->>'asof')::timestamptz;
      v_after_score := (v_cursor->>'score')::numeric;
    exception when others then
      raise exception 'invalid cursor' using errcode = '22023';
    end;
    if v_cursor->>'sig' is distinct from v_signature or v_cursor->>'sort' is distinct from v_sort
      or v_after_at is null or v_after_id is null or v_asof is null
      or (v_sort = 'relevance' and v_after_score is null) then
      raise exception 'cursor does not match this search' using errcode = '22023';
    end if;
  end if;

  with matches as (
    select d.*,
      case when v_sort = 'relevance' then round((
        0.75 * (ts_rank(d.document, v_tsquery, 32)
          + coalesce((select avg(extensions.word_similarity(t, d.search_text)) from unnest(v_terms) t), 0)) / 2
        + 0.25 / (1 + greatest(extract(epoch from (v_asof - d.published_at)), 0) / 2592000.0)
      )::numeric, 6) end as score
    from private.post_search_documents d
    where d.is_visible
      and exists(select 1 from private.public_eligible_posts eligible where eligible.id=d.post_id)
      and d.published_at <= v_asof
      and (d.visible_until is null or d.visible_until > statement_timestamp())
      and (v_terms is null or not exists (
        select 1 from unnest(v_terms) t
        where not (d.document @@ to_tsquery('simple', t || ':*')
          or (length(t) >= 4 and extensions.word_similarity(t, d.search_text) >= 0.5))))
      and (v_area is null or d.area = v_area)
      and (v_activity is null or d.activity_key = v_activity)
      and (v_province is null or d.province_id = v_province)
      and (v_city is null or d.city_id = v_city)
      and (v_price_mode is null or d.price_mode = v_price_mode)
      and (v_condition is null or (d.kind='listing' and d.facets->>'condition'=v_condition))
      and (v_min is null or d.price_cents >= v_min)
      and (v_max is null or d.price_cents <= v_max)
      and (v_contains = '{}' or d.facets @> v_contains)
      and not exists (
        select 1 from jsonb_array_elements(v_ranges) r
        where not (jsonb_typeof(d.facets->(r->>'key')) = 'number'
          and (r->'min' is null or (d.facets->>(r->>'key'))::numeric >= (r->>'min')::numeric)
          and (r->'max' is null or (d.facets->>(r->>'key'))::numeric <= (r->>'max')::numeric))
      )
  ),
  scoped as (
    select * from matches m where v_category is null or m.category_key = v_category
  ),
  page as (
    select * from scoped s
    where v_after_at is null
      or (v_sort = 'newest' and (s.published_at, s.post_id) < (v_after_at, v_after_id))
      or (v_sort = 'relevance' and (s.score, s.published_at, s.post_id) < (v_after_score, v_after_at, v_after_id))
    order by case when v_sort = 'relevance' then s.score end desc nulls last, s.published_at desc, s.post_id desc
    limit v_limit + 1
  )
  select
    (select jsonb_object_agg(x.category_key, x.n)
      from (select m.category_key, count(*) n from matches m group by m.category_key) x),
    (select count(*) from scoped),
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.post_id, 'kind', p.kind, 'area', p.area,
        'category', p.category_key, 'activity', p.activity_key, 'title', p.title, 'summary', p.summary,
        'price_mode', p.price_mode, 'price_cents', p.price_cents::text, 'province', p.province_id,
        'condition', case when p.kind='listing' then p.facets->>'condition' end,
        'city', p.city_id, 'locality', p.locality_label, 'published_at', p.published_at,
        'score', p.score::text)
        order by case when v_sort = 'relevance' then p.score end desc nulls last,
          p.published_at desc, p.post_id desc), '[]') from page p),
    (select count(*) > v_limit from page)
  into v_facets, v_total, v_items, v_has_more;
  if v_has_more then
    v_items := v_items - v_limit;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'sort', v_sort,
    'total', v_total,
    'facets', jsonb_build_object('categories', coalesce(v_facets, '{}')),
    'next_cursor', case when v_has_more then
      translate(encode(convert_to(jsonb_build_object('at', v_items->(v_limit - 1)->>'published_at',
        'id', v_items->(v_limit - 1)->>'id', 'score', v_items->(v_limit - 1)->>'score',
        'sort', v_sort, 'asof', v_asof, 'sig', v_signature)::text, 'UTF8'), 'base64'), E'+/\n', '-_')
      end
  );
end;
$$;
revoke all on function internal.search_posts(jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.search_posts(jsonb) to anon, authenticated;
create function api.search_posts(p_request jsonb)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.search_posts(p_request);
$$;
revoke all on function api.search_posts(jsonb) from public, anon, authenticated, service_role;
grant execute on function api.search_posts(jsonb) to anon, authenticated;

-- Source: docs/backend-foundation/prototypes/entitlements.sql
-- BF-07 canonical entitlement and provider transaction candidate. One model:
-- immutable plan/add-on versions, priced payment snapshots, a provider event
-- inbox, entitlements with explicit funding sources, capacity-locked post
-- activations and add-on time windows. Replaces slot_entitlements, the
-- legacy area-entitlement mirror, mutable boost/featured/urgent columns and
-- free-post counters. Organisations, sponsorship lifecycle, staff AAL2 and
-- invoices' legal numbering remain BF-08/BF-16/BF-17 work.

create table private.plan_versions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  plan_code text not null check (plan_code ~ '^[a-z][a-z0-9_]{0,59}$'),
  version integer not null check (version > 0),
  area text check (area in ('market', 'business', 'tourism_events')),
  label text not null check (length(label) between 1 and 120),
  price_cents bigint not null check (price_cents between 100 and 100000000),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  duration_days integer not null check (duration_days between 1 and 366),
  slot_capacity integer not null check (slot_capacity between 1 and 1000),
  activations_per_period integer check (activations_per_period between 1 and 10000),
  activation_period_days integer not null default 30 check (activation_period_days between 1 and 366),
  max_photos integer not null check (max_photos between 1 and 50),
  max_videos integer not null check (max_videos between 0 and 10),
  -- Closed, default-denied purchase rights; catalogue immutability also freezes these.
  addon_capabilities text[] not null default '{}' check (case
    when coalesce(array_ndims(addon_capabilities),1)<>1 then false else
    addon_capabilities <@ array['boost','featured','urgent']::text[]
    and array_position(addon_capabilities,null) is null
    and cardinality(addon_capabilities)=(('boost'=any(addon_capabilities))::integer
      +('featured'=any(addon_capabilities))::integer+('urgent'=any(addon_capabilities))::integer) end),
  is_public boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  retired_at timestamptz,
  unique (plan_code, version)
);

create table private.addon_versions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  kind text not null check (kind in ('boost', 'featured', 'urgent')),
  version integer not null check (version > 0),
  days integer not null check (days between 1 and 90),
  price_cents bigint not null check (price_cents between 100 and 10000000),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  created_at timestamptz not null default statement_timestamp(),
  retired_at timestamptz,
  unique (kind, days, version)
);

-- Catalogue rows are immutable once published; a price change is a new version.
create function internal.catalogue_version_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'catalogue versions are retained' using errcode = '23514';
  end if;
  if (to_jsonb(new) - 'retired_at') is distinct from (to_jsonb(old) - 'retired_at')
    or (old.retired_at is not null and new.retired_at is distinct from old.retired_at) then
    raise exception 'catalogue versions are immutable; publish a new version' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.catalogue_version_guard() from public, anon, authenticated, service_role;
create trigger plan_versions_immutable before update or delete on private.plan_versions
  for each row execute function internal.catalogue_version_guard();
create trigger addon_versions_immutable before update or delete on private.addon_versions
  for each row execute function internal.catalogue_version_guard();

create table private.payments (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  product_kind text not null check (product_kind in ('plan', 'addon')),
  plan_version_id uuid references private.plan_versions (id),
  addon_version_id uuid references private.addon_versions (id),
  -- Historical identity, intentionally not a live-post FK: deletion cannot
  -- remove the priced quote or prevent recognition of a late settlement.
  target_post_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency = 'ZAR'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'complete', 'failed', 'cancelled', 'expired', 'refunded', 'chargeback')),
  fulfillment_status text not null default 'unfulfilled'
    check (fulfillment_status in ('unfulfilled', 'fulfilled', 'needs_reconciliation', 'reversed')),
  merchant_reference text not null unique default replace(pg_catalog.gen_random_uuid()::text, '-', ''),
  provider text not null default 'ozow' check (provider = 'ozow'),
  provider_request_id text unique check (length(provider_request_id) between 1 and 100),
  provider_transaction_id text unique check (length(provider_transaction_id) between 1 and 100),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  status_changed_at timestamptz not null default statement_timestamp(),
  check ((product_kind = 'plan' and plan_version_id is not null and addon_version_id is null and target_post_id is null)
    or (product_kind = 'addon' and addon_version_id is not null and plan_version_id is null and target_post_id is not null)),
  check ((status = 'complete') = (completed_at is not null and provider_transaction_id is not null)
    or status in ('refunded', 'chargeback')),
  check (status <> 'complete' or fulfillment_status <> 'unfulfilled')
);
create function internal.payment_quote_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if (new.id,new.owner_id,new.product_kind,new.plan_version_id,new.addon_version_id,
      new.target_post_id,new.amount_cents,new.currency,new.snapshot,new.merchant_reference,new.provider)
    is distinct from (old.id,old.owner_id,old.product_kind,old.plan_version_id,old.addon_version_id,
      old.target_post_id,old.amount_cents,old.currency,old.snapshot,old.merchant_reference,old.provider) then
    raise exception 'payment quote and historical target are immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.payment_quote_guard() from public,anon,authenticated,service_role;
create trigger payments_quote_immutable before update on private.payments
  for each row execute function internal.payment_quote_guard();
-- One open checkout per member and product; retries reuse it.
create unique index payments_one_pending_idx on private.payments
  (owner_id, coalesce(plan_version_id, addon_version_id), coalesce(target_post_id, '00000000-0000-0000-0000-000000000000'))
  where status = 'pending';

-- Inbox: every provider notification is recorded once, before it has any effect.
create table private.provider_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  provider text not null check (provider = 'ozow'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  merchant_reference text not null,
  provider_request_id text not null,
  provider_transaction_id text,
  reported_status text not null check (reported_status in ('complete', 'cancelled', 'error', 'abandoned', 'pending')),
  amount_cents bigint not null,
  currency text not null,
  payment_id uuid references private.payments (id) on delete restrict,
  outcome text not null,
  received_at timestamptz not null default statement_timestamp(),
  unique (provider, payload_sha256)
);

create table private.entitlements (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  source text not null check (source in ('retail_paid', 'intro_trial', 'sponsorship', 'contract', 'staff_grant')),
  area text check (area in ('market', 'business', 'tourism_events')),
  payment_id uuid unique references private.payments (id) on delete restrict,
  sponsorship_id uuid,
  contract_id uuid,
  granted_by uuid references auth.users (id) on delete restrict,
  slot_capacity integer not null check (slot_capacity between 1 and 1000),
  activations_per_period integer check (activations_per_period between 1 and 10000),
  activation_period_days integer not null default 30 check (activation_period_days between 1 and 366),
  max_photos integer not null check (max_photos between 1 and 50),
  max_videos integer not null check (max_videos between 0 and 10),
  starts_at timestamptz not null,
  addon_capabilities text[] not null default '{}' check (case
    when coalesce(array_ndims(addon_capabilities),1)<>1 then false else
    addon_capabilities <@ array['boost','featured','urgent']::text[]
    and array_position(addon_capabilities,null) is null
    and cardinality(addon_capabilities)=(('boost'=any(addon_capabilities))::integer
      +('featured'=any(addon_capabilities))::integer+('urgent'=any(addon_capabilities))::integer) end),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'pending_verification', 'revoked')),
  revoked_reason text,
  created_at timestamptz not null default statement_timestamp(),
  check (ends_at > starts_at),
  check ((source = 'retail_paid') = (payment_id is not null)),
  check (source <> 'sponsorship' or sponsorship_id is not null),
  check (source <> 'contract' or contract_id is not null),
  check (source <> 'staff_grant' or granted_by is not null),
  check ((status = 'revoked') = (revoked_reason is not null)),
  check (source<>'intro_trial' or addon_capabilities='{}'::text[])
);
create index entitlements_owner_usable_idx on private.entitlements (owner_id, ends_at) where status = 'active';

create function internal.entitlement_capability_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.addon_capabilities is distinct from old.addon_capabilities then
    raise exception 'issued capabilities are immutable; issue a reviewed replacement grant' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.entitlement_capability_guard() from public,anon,authenticated,service_role;
create trigger entitlement_capabilities_immutable before update of addon_capabilities on private.entitlements
  for each row execute function internal.entitlement_capability_guard();

create table private.entitlement_members (
  entitlement_id uuid not null references private.entitlements (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (entitlement_id, member_id)
);
create index entitlement_members_member_idx on private.entitlement_members(member_id,entitlement_id);

-- Identity-bound trial claims: one introductory trial per verified identity.
-- DEC-27: kept while the account exists. When the account is deleted the
-- fingerprint is detached from the account and trial and kept for 3 years, so
-- the same identity cannot claim another free trial, then purged.
create table private.trial_identities (
  identity_hmac text primary key check (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  owner_id uuid references auth.users (id) on delete restrict,
  entitlement_id uuid unique references private.entitlements (id) on delete restrict,
  claimed_at timestamptz not null default statement_timestamp(),
  detached_at timestamptz,
  retain_until timestamptz,
  check ((owner_id is null) = (detached_at is not null)),
  check ((owner_id is null) = (entitlement_id is null)),
  check ((detached_at is null) = (retain_until is null)),
  check (retain_until is null or retain_until = detached_at + interval '3 years')
);
create index trial_identities_expiry_idx on private.trial_identities (retain_until) where retain_until is not null;

-- Activation history outlives its post: activations_per_period counts these
-- rows, so deleting a post must not reset the re-post allowance (DEC-28).
create table private.post_activations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  post_id uuid references private.posts (id) on delete set null,
  entitlement_id uuid not null references private.entitlements (id) on delete restrict,
  owner_id uuid not null references auth.users (id) on delete restrict,
  activated_at timestamptz not null default statement_timestamp(),
  released_at timestamptz,
  release_reason text check (release_reason in ('owner', 'sold', 'expired', 'entitlement_ended', 'payment_reversed', 'moderation', 'deleted')),
  check ((released_at is null) = (release_reason is null)),
  check (post_id is not null or released_at is not null)
);
create unique index post_activations_one_active_idx on private.post_activations (post_id) where released_at is null;
create index post_activations_entitlement_idx on private.post_activations (entitlement_id, activated_at);

-- Content-bound trial provenance survives pause/release and another plan purchase.
create table private.post_trial_claims (
  post_id uuid primary key references private.posts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  trial_entitlement_id uuid not null references private.entitlements(id) on delete restrict,
  claimed_at timestamptz not null default clock_timestamp(),
  converted_at timestamptz,
  converted_by_activation_id uuid references private.post_activations(id) on delete restrict,
  check ((converted_at is null)=(converted_by_activation_id is null)),
  check (converted_at is null or converted_at>=claimed_at)
);
alter table private.post_trial_claims enable row level security;
revoke all on private.post_trial_claims from public,anon,authenticated,service_role;
create index post_trial_claims_owner_idx on private.post_trial_claims(owner_id,post_id);

create function internal.entitlement_for_post_eligible(p_ent uuid,p_post uuid,p_owner uuid)
returns boolean language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
  return exists(select 1 from private.entitlements e join private.posts p on p.id=p_post
    where e.id=p_ent and p.owner_id=p_owner
      and e.status='active' and e.starts_at<=clock_timestamp() and e.ends_at>clock_timestamp()
      and (e.area is null or e.area=p.area)
      and (e.owner_id=p_owner or exists(select 1 from private.entitlement_members m
        where m.entitlement_id=e.id and m.member_id=p_owner))
      and exists(select 1 from private.current_account_access u where u.id=p_owner)
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
        where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete')));
end;
$$;
revoke all on function internal.entitlement_for_post_eligible(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function internal.track_post_trial_funding()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare ent private.entitlements;
begin
  select e.* into ent from private.entitlements e where e.id=new.entitlement_id;
  if new.released_at is not null or not internal.entitlement_for_post_eligible(ent.id,new.post_id,new.owner_id) then
    return new; -- invalid/historical inserts cannot create a conversion proof
  end if;
  if ent.source='intro_trial' then
    insert into private.post_trial_claims(post_id,owner_id,trial_entitlement_id)
    values(new.post_id,new.owner_id,ent.id) on conflict(post_id) do nothing;
  elsif ent.source='retail_paid' and exists(select 1 from private.payments p
      where p.id=ent.payment_id and p.owner_id=ent.owner_id and p.status='complete') then
    update private.post_trial_claims set converted_at=clock_timestamp(),converted_by_activation_id=new.id
    where post_id=new.post_id and owner_id=new.owner_id and converted_at is null;
  end if;
  return new;
end;
$$;
revoke all on function internal.track_post_trial_funding() from public,anon,authenticated,service_role;
create trigger post_activation_trial_provenance after insert on private.post_activations
  for each row execute function internal.track_post_trial_funding();

-- Deleting a post (owner, lifecycle sweep or account deletion) first releases
-- its slot; the foreign key then keeps the history row with a null post.
create function internal.release_activation_on_post_delete()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  update private.post_activations set released_at = statement_timestamp(), release_reason = 'deleted'
  where post_id = old.id and released_at is null;
  update private.post_addon_windows set revoked_at = clock_timestamp()
  where post_id = old.id and revoked_at is null;
  return old;
end;
$$;
revoke all on function internal.release_activation_on_post_delete() from public, anon, authenticated, service_role;
create trigger posts_release_activation before delete on private.posts
  for each row execute function internal.release_activation_on_post_delete();

-- Paid visibility is a time window, never a stored boolean that can go stale.
create table private.post_addon_windows (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  post_id uuid not null, -- immutable historical target; retained after deletion
  kind text not null check (kind in ('boost', 'featured', 'urgent')),
  payment_id uuid not null unique references private.payments (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  revoked_at timestamptz
);
create index post_addon_windows_live_idx on private.post_addon_windows (post_id, kind, ends_at) where revoked_at is null;

create table private.invoices (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  payment_id uuid not null unique references private.payments (id) on delete restrict,
  invoice_number text not null unique,
  amount_ex_vat_cents bigint not null,
  vat_cents bigint not null,
  total_cents bigint not null,
  description text not null,
  issued_at timestamptz not null default statement_timestamp(),
  check (amount_ex_vat_cents + vat_cents = total_cents)
);

-- Durable after-commit effects (email, notifications); workers claim with fencing.
create table private.outbox_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  kind text not null check (kind in ('payment_completed', 'payment_reversed', 'payment_reconciliation_required', 'trial_started',
    'post_expired', 'post_expiry_reminder', 'draft_deletion_warning', 'post_deleted', 'verification_phone_confirmed', 'identity_accepted')),
  subject_id uuid not null,
  owner_id uuid not null,
  dedupe_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz
);

alter table private.plan_versions enable row level security;
alter table private.addon_versions enable row level security;
alter table private.payments enable row level security;
alter table private.provider_events enable row level security;
alter table private.entitlements enable row level security;
alter table private.entitlement_members enable row level security;
alter table private.trial_identities enable row level security;
alter table private.post_activations enable row level security;
alter table private.post_addon_windows enable row level security;
alter table private.invoices enable row level security;
alter table private.outbox_events enable row level security;
revoke all on private.plan_versions, private.addon_versions, private.payments, private.provider_events,
  private.entitlements, private.entitlement_members, private.trial_identities, private.post_activations,
  private.post_addon_windows, private.invoices, private.outbox_events
  from public, anon, authenticated, service_role;

-- Usable means active, inside its window, and evaluated at read time.
create function internal.entitlement_usable(p_status text, p_starts timestamptz, p_ends timestamptz)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select p_status = 'active' and p_starts <= statement_timestamp() and p_ends > statement_timestamp();
$$;
revoke all on function internal.entitlement_usable(text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function internal.entitlement_usable(text, timestamptz, timestamptz) to authenticated, service_role;

-- Public catalogue: current, non-retired public versions only.
create function internal.billing_catalogue()
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.plan_code, 'label', p.label,
        'area', p.area, 'price_cents', p.price_cents::text, 'currency', p.currency, 'duration_days', p.duration_days,
        'slot_capacity', p.slot_capacity, 'max_photos', p.max_photos, 'max_videos', p.max_videos,
        'addon_capabilities',to_jsonb(p.addon_capabilities))
        order by p.price_cents, p.plan_code)
      from private.plan_versions p where p.is_public and p.retired_at is null), '[]'),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'days', a.days,
        'price_cents', a.price_cents::text, 'currency', a.currency) order by a.kind, a.days)
      from private.addon_versions a where a.retired_at is null), '[]'));
$$;
revoke all on function internal.billing_catalogue() from public, anon, authenticated, service_role;
grant execute on function internal.billing_catalogue() to anon, authenticated;
create function api.billing_catalogue()
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.billing_catalogue();
$$;
revoke all on function api.billing_catalogue() from public, anon, authenticated, service_role;
grant execute on function api.billing_catalogue() to anon, authenticated;

-- Checkout: the member names only a product (and target post for add-ons). Price,
-- currency, term and capacity come from the stored version and are snapshotted.
create function internal.addon_purchase_entitlement(p_owner uuid,p_post uuid,p_addon text)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare target_area text; candidate uuid;
begin
  if p_owner is null or p_post is null or p_addon is null or p_addon not in('boost','featured','urgent') then return null; end if;
  select p.area into target_area from private.posts p where p.id=p_post and p.owner_id=p_owner;
  if not found then return null; end if;
  -- Owner/member indexes bound discovery. NOWAIT avoids mixed activation lock-order waits.
  for candidate in select e.id from private.entitlements e
    where e.id in(select owned.id from private.entitlements owned where owned.owner_id=p_owner and owned.status='active'
      union select m.entitlement_id from private.entitlement_members m where m.member_id=p_owner)
      and e.status='active' and (e.area is null or e.area=target_area)
      and p_addon=any(e.addon_capabilities) order by e.id
  loop
    begin
      perform e.id from private.entitlements e where e.id=candidate for update nowait;
    exception when lock_not_available then
      raise exception 'purchase capability is busy; retry the same operation' using errcode='PT409';
    end;
    -- Revalidate after preceding waits; busy entitlement rows require explicit retry.
    if exists(select 1 from private.entitlements e join private.posts p on p.id=p_post
      where e.id=candidate and p.owner_id=p_owner
        and internal.entitlement_for_post_eligible(e.id,p.id,p_owner)
        and p_addon=any(e.addon_capabilities)
        and not exists(select 1 from private.post_trial_claims c where c.post_id=p.id and c.converted_at is null)
        and (p_addon='urgent' or p.kind='event')
        and p.status='live' and p.published_at<=clock_timestamp() and p.visible_until>clock_timestamp()
        and exists(select 1 from private.public_eligible_posts visible where visible.id=p.id)
        and exists(select 1 from internal.post_funding(p.id) f where f.funded_until>clock_timestamp()))
    then return candidate; end if;
  end loop;
  return null;
end;
$$;
revoke all on function internal.addon_purchase_entitlement(uuid,uuid,text) from public,anon,authenticated,service_role;

create function internal.start_checkout(p_product_id uuid, p_target_post uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.price_draft_actor();
  plan private.plan_versions;
  addon private.addon_versions;
  pay private.payments;
  target private.posts;
  purchase_entitlement uuid;
begin
  if p_product_id is null then raise exception 'product required' using errcode = '22023'; end if;
  perform internal.lock_evidence_subject(actor);
  perform internal.price_draft_actor();
  select * into plan from private.plan_versions v where v.id = p_product_id and v.retired_at is null and v.is_public;
  if not found then
    select * into addon from private.addon_versions v where v.id = p_product_id and v.retired_at is null;
    if not found then raise exception 'product not available' using errcode = '22023'; end if;
    select * into target from private.posts p where p.id=p_target_post and p.owner_id=actor for update;
    if not found or target.status <> 'live' then
      raise exception 'add-ons apply to your own live post' using errcode = '22023';
    end if;
    if addon.kind in ('boost','featured') and target.kind <> 'event' then
      raise exception 'Boost and Featured are offered only for events' using errcode='22023';
    end if;
    if not exists(select 1 from private.public_eligible_posts p where p.id=target.id)
      or target.published_at>clock_timestamp() or target.visible_until<=clock_timestamp()
      or not exists(select 1 from internal.post_funding(target.id) f where f.funded_until>clock_timestamp()) then
      raise exception 'add-on target is no longer publicly eligible' using errcode='PT409';
    end if;
    purchase_entitlement:=internal.addon_purchase_entitlement(actor,target.id,addon.kind);
    if purchase_entitlement is null then
      raise exception 'an eligible paid capability for this area and converted content is required' using errcode='PT403';
    end if;
  elsif p_target_post is not null then
    raise exception 'plans do not take a target post' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  select * into pay from private.payments p
    where p.owner_id = actor and p.status = 'pending'
      and coalesce(p.plan_version_id, p.addon_version_id) = p_product_id
      and p.target_post_id is not distinct from p_target_post;
  if not found then
    insert into private.payments (owner_id, product_kind, plan_version_id, addon_version_id, target_post_id,
      amount_cents, currency, snapshot)
    values (actor, case when plan.id is not null then 'plan' else 'addon' end, plan.id, addon.id, p_target_post,
      coalesce(plan.price_cents, addon.price_cents), coalesce(plan.currency, addon.currency),
      case when plan.id is not null then jsonb_build_object('kind', 'plan', 'code', plan.plan_code,
          'version', plan.version, 'label', plan.label, 'area', plan.area, 'price_cents', plan.price_cents,
          'duration_days', plan.duration_days, 'slot_capacity', plan.slot_capacity,
          'activations_per_period', plan.activations_per_period, 'activation_period_days', plan.activation_period_days,
          'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
          'addon_capabilities',to_jsonb(plan.addon_capabilities))
        else jsonb_build_object('kind', 'addon', 'addon', addon.kind, 'version', addon.version,
          'days', addon.days, 'price_cents', addon.price_cents, 'target_kind',target.kind,
          'target_area',target.area,'target_owner_id',target.owner_id,
          'purchase_entitlement_id',purchase_entitlement,
          'addon_capabilities',(select to_jsonb(e.addon_capabilities) from private.entitlements e where e.id=purchase_entitlement)) end)
    returning * into pay;
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'reused', pay.created_at < statement_timestamp());
end;
$$;
revoke all on function internal.start_checkout(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.start_checkout(uuid, uuid) to authenticated;
create function api.start_checkout(p_product_id uuid, p_target_post uuid default null)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.start_checkout(p_product_id, p_target_post);
$$;
revoke all on function api.start_checkout(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function api.start_checkout(uuid, uuid) to authenticated;

-- Server-only: record the provider's request id after the checkout call succeeds.
create function internal.attach_provider_request(p_payment_id uuid, p_request_id text)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
begin
  update private.payments p set provider_request_id = p_request_id
  where p.id = p_payment_id and p.status = 'pending'
    and (p.provider_request_id is null or p.provider_request_id = p_request_id);
  if not found then raise exception 'payment not pending or request id differs' using errcode = '22023'; end if;
  return true;
end;
$$;
revoke all on function internal.attach_provider_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.attach_provider_request(uuid, text) to service_role;
create function api.attach_provider_request(p_payment_id uuid, p_request_id text)
returns boolean language sql security invoker set search_path = pg_catalog as $$
  select internal.attach_provider_request(p_payment_id, p_request_id);
$$;
revoke all on function api.attach_provider_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.attach_provider_request(uuid, text) to service_role;

-- Server-only: apply a verified provider notification (the Worker checks the
-- provider hash before calling). Idempotent, ordered by payment row lock, and
-- every effect (status, entitlement or window, invoice, outbox) is one commit.
create function internal.apply_provider_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  ev jsonb := p_event;
  pay private.payments;
  snap jsonb;
  outcome text;
  window_start timestamptz;
  vat bigint;
  ent uuid;
  payment_owner uuid;
  prior private.provider_events;
  target private.posts;
  fulfillable boolean;
begin
  if jsonb_typeof(ev) <> 'object' or not (array(select jsonb_object_keys(ev)) <@ array['payload_sha256',
      'merchant_reference', 'provider_request_id', 'provider_transaction_id', 'status', 'amount_cents', 'currency'])
    or ev->>'payload_sha256' !~ '^[a-f0-9]{64}$' or jsonb_typeof(ev->'amount_cents') <> 'number'
    or ev->>'status' not in ('complete', 'cancelled', 'error', 'abandoned', 'pending')
    or nullif(ev->>'merchant_reference', '') is null or nullif(ev->>'provider_request_id', '') is null then
    raise exception 'invalid provider event' using errcode = '22023';
  end if;
  -- Serialize identical payloads, including unknown references. Then acquire
  -- the immutable owner's fence before any payment/post row lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('provider_event:'||(ev->>'payload_sha256'),707));
  select * into prior from private.provider_events e where e.provider='ozow' and e.payload_sha256=ev->>'payload_sha256';
  if found then
    return jsonb_build_object('outcome','duplicate_event','original_outcome',prior.outcome,'payment_id',prior.payment_id);
  end if;
  select p.owner_id into payment_owner from private.payments p where p.merchant_reference=ev->>'merchant_reference';
  if payment_owner is not null then perform internal.lock_evidence_subject(payment_owner); end if;
  select * into pay from private.payments p where p.merchant_reference = ev->>'merchant_reference' for update;
  if not found then
    outcome := 'unknown_reference';
  elsif pay.provider_request_id is distinct from ev->>'provider_request_id' then
    outcome := 'request_mismatch';
  elsif (ev->>'amount_cents')::bigint is distinct from pay.amount_cents or ev->>'currency' is distinct from pay.currency then
    outcome := 'amount_mismatch';
  elsif pay.status = 'complete' then
    outcome := case when ev->>'status' <> 'complete' then 'late_status_ignored'
      when pay.provider_transaction_id = ev->>'provider_transaction_id' then 'already_complete'
      else 'conflicting_transaction' end;
  elsif pay.status in ('refunded', 'chargeback') then
    outcome := 'reversed_ignored';
  elsif ev->>'status' <> 'complete' then
    -- A late failure never undoes a completion; a pending payment records the final state.
    if pay.status = 'pending' and ev->>'status' in ('cancelled', 'error', 'abandoned') then
      update private.payments set status = case ev->>'status' when 'cancelled' then 'cancelled' else 'failed' end,
        status_changed_at = statement_timestamp() where id = pay.id;
      outcome := 'not_paid';
    else
      outcome := 'no_change';
    end if;
  elsif nullif(ev->>'provider_transaction_id', '') is null then
    outcome := 'missing_transaction';
  elsif exists (select 1 from private.payments p where p.provider_transaction_id = ev->>'provider_transaction_id') then
    outcome := 'transaction_reused';
  else
    -- Failed/expired checkouts may still fulfill on verified late payment.
    -- Explicit cancellation never reactivates benefits: retain receipt and
    -- route it to reconciliation, independently of current target eligibility.
    snap := pay.snapshot;
    fulfillable := pay.status<>'cancelled'
      and exists(select 1 from private.current_account_access u where u.id=pay.owner_id);
    if pay.product_kind='addon' then
      select * into target from private.posts p where p.id=pay.target_post_id for update;
      fulfillable := fulfillable and found and target.owner_id=pay.owner_id
        and target.owner_id::text=snap->>'target_owner_id'
        and target.kind=snap->>'target_kind' and target.area=snap->>'target_area'
        and (snap->>'addon'='urgent' or target.kind='event')
        and target.published_at<=clock_timestamp() and target.visible_until>clock_timestamp()
        and exists(select 1 from private.public_eligible_posts p where p.id=target.id)
        and exists(select 1 from internal.post_funding(target.id) f where f.funded_until>clock_timestamp());
      if fulfillable then
        fulfillable:=coalesce((snap->'addon_capabilities') ? (snap->>'addon'),false)
          and internal.addon_purchase_entitlement(pay.owner_id,target.id,snap->>'addon') is not null;
      end if;
    end if;
    fulfillable := coalesce(fulfillable,false);
    update private.payments set status = 'complete', completed_at = statement_timestamp(),
      provider_transaction_id = ev->>'provider_transaction_id', status_changed_at = statement_timestamp(),
      fulfillment_status=case when fulfillable then 'fulfilled' else 'needs_reconciliation' end
    where id = pay.id;
    if not fulfillable then
      -- Receipt of verified funds is a financial fact. Never roll it back just
      -- because the old target/account disappeared or became ineligible.
      insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('payment_reconciliation_required',pay.id,pay.owner_id,'payment_reconciliation_required:'||pay.id);
    elsif pay.product_kind = 'plan' then
      insert into private.entitlements (owner_id, source, area, payment_id, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))))
      returning id into ent;
    else
      -- Stacking: a new window starts when the member's current window of that kind ends.
      select greatest(statement_timestamp(), coalesce(max(w.ends_at), statement_timestamp())) into window_start
      from private.post_addon_windows w
      where w.post_id = pay.target_post_id and w.kind = snap->>'addon' and w.revoked_at is null;
      insert into private.post_addon_windows (post_id, kind, payment_id, starts_at, ends_at)
      values (pay.target_post_id, snap->>'addon', pay.id, window_start,
        window_start + make_interval(days => (snap->>'days')::integer));
    end if;
    vat := round(pay.amount_cents::numeric * 15 / 115);
    insert into private.invoices (payment_id, invoice_number, amount_ex_vat_cents, vat_cents, total_cents, description)
    values (pay.id, 'INV-' || to_char(statement_timestamp() at time zone 'Africa/Johannesburg', 'YYYYMMDD') || '-'
        || upper(left(replace(pay.id::text, '-', ''), 10)),
      pay.amount_cents - vat, vat, pay.amount_cents, coalesce(snap->>'label', initcap(snap->>'addon') || ' ' || (snap->>'days') || ' days'));
    insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
    values ('payment_completed', pay.id, pay.owner_id, 'payment_completed:' || pay.id);
    outcome := case when fulfillable then 'completed' else 'complete_unfulfillable_target' end;
  end if;
  insert into private.provider_events (provider, payload_sha256, merchant_reference, provider_request_id,
    provider_transaction_id, reported_status, amount_cents, currency, payment_id, outcome)
  values ('ozow', ev->>'payload_sha256', ev->>'merchant_reference', ev->>'provider_request_id',
    nullif(ev->>'provider_transaction_id', ''), ev->>'status', (ev->>'amount_cents')::bigint,
    coalesce(ev->>'currency', ''), pay.id, outcome);
  return jsonb_build_object('outcome', outcome, 'payment_id', pay.id,
    'fulfillment_status',(select p.fulfillment_status from private.payments p where p.id=pay.id));
end;
$$;
revoke all on function internal.apply_provider_event(jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.apply_provider_event(jsonb) to service_role;
create function api.apply_provider_event(p_event jsonb)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.apply_provider_event(p_event);
$$;
revoke all on function api.apply_provider_event(jsonb) from public, anon, authenticated, service_role;
grant execute on function api.apply_provider_event(jsonb) to service_role;

-- Owner activation. Usable entitlements are locked in a fixed order (soonest end
-- first) so concurrent activations serialise and capacity can never be exceeded.
create function internal.activate_post(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  current_activation private.post_activations;
  ent private.entitlements;
  used integer;
  any_usable boolean := false;
begin
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  select * into current_activation from private.post_activations a where a.post_id = post.id and a.released_at is null;
  if found then
    select * into ent from private.entitlements e where e.id = current_activation.entitlement_id for update;
    if internal.entitlement_for_post_eligible(ent.id,post.id,actor) then
      perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('activation_id', current_activation.id, 'entitlement_id', ent.id, 'reused', true);
    end if;
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'entitlement_ended'
      where id = current_activation.id;
  end if;
  for ent in
    select e.* from private.entitlements e
    where internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
      and (e.area is null or e.area = post.area)
      and (e.owner_id = actor or exists (select 1 from private.entitlement_members m
        where m.entitlement_id = e.id and m.member_id = actor))
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
        where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'))
    order by e.ends_at, e.id
    for update
  loop
    -- Cursor predicates may predate a row wait; re-read all authority and wall time.
    continue when not internal.entitlement_for_post_eligible(ent.id,post.id,actor);
    any_usable := true;
    select count(*) into used from private.post_activations a where a.entitlement_id = ent.id and a.released_at is null;
    continue when used >= ent.slot_capacity;
    if ent.activations_per_period is not null then
      select count(*) into used from private.post_activations a where a.entitlement_id = ent.id
        and a.activated_at > statement_timestamp() - make_interval(days => ent.activation_period_days);
      continue when used >= ent.activations_per_period;
    end if;
    insert into private.post_activations (post_id, entitlement_id, owner_id) values (post.id, ent.id, actor)
      returning * into current_activation;
    perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('activation_id', current_activation.id, 'entitlement_id', ent.id, 'reused', false);
  end loop;
  if any_usable then
    raise exception 'all posting capacity is in use' using errcode = 'PT409';
  end if;
  raise exception 'no active plan covers this post' using errcode = 'PT402';
end;
$$;
revoke all on function internal.activate_post(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.activate_post(uuid) to authenticated;
create function api.activate_post(p_post_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.activate_post(p_post_id);
$$;
revoke all on function api.activate_post(uuid) from public, anon, authenticated, service_role;
grant execute on function api.activate_post(uuid) to authenticated;

create function internal.release_post(p_post_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts; released boolean;
begin
  if p_reason is null or p_reason not in ('owner', 'sold') then raise exception 'invalid release reason' using errcode = '22023'; end if;
  select p.* into post from private.posts p where p.id=p_post_id and p.owner_id=actor for update;
  if not found or post.status in ('live','pending_moderation') then
    raise exception 'use the revision-fenced post lifecycle to release published funding' using errcode='22023';
  end if;
  update private.post_activations a set released_at = statement_timestamp(), release_reason = p_reason
  where a.post_id = p_post_id and a.owner_id = actor and a.released_at is null;
  released:=found;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return released;
end;
$$;
revoke all on function internal.release_post(uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.release_post(uuid, text) to authenticated;
create function api.release_post(p_post_id uuid, p_reason text default 'owner')
returns boolean language sql security invoker set search_path = pg_catalog as $$
  select internal.release_post(p_post_id, p_reason);
$$;
revoke all on function api.release_post(uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.release_post(uuid, text) to authenticated;

create function internal.my_posting_capacity()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  -- The disposable prototype installs current account authority next. The clean
  -- baseline must create authority relations before dependent API functions.
  return (
  with actor as (select internal.price_draft_actor() as id),
  usable as (
    select e.* from private.entitlements e, actor
    where internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
      and (e.owner_id = actor.id or exists (select 1 from private.entitlement_members m
        where m.entitlement_id = e.id and m.member_id = actor.id))
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
        where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'))
  )
  select jsonb_build_object(
    'capacity', coalesce(sum(u.slot_capacity), 0),
    'active', (select count(*) from private.post_activations a where a.released_at is null
      and a.entitlement_id in (select id from usable)),
    'ends_at', max(u.ends_at),
    'sources', coalesce(jsonb_agg(distinct u.source) filter (where u.source is not null), '[]'))
  from usable u);
end;
$$;
revoke all on function internal.my_posting_capacity() from public, anon, authenticated, service_role;
grant execute on function internal.my_posting_capacity() to authenticated;
create function api.my_posting_capacity()
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.my_posting_capacity();
$$;
revoke all on function api.my_posting_capacity() from public, anon, authenticated, service_role;
grant execute on function api.my_posting_capacity() to authenticated;

-- Server-only introductory trial grant; the HMAC unique key enforces one per identity.
create function internal.grant_intro_trial(p_owner uuid, p_identity_hmac text, p_days integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare ent uuid;
begin
  if p_days not in (7, 30) then raise exception 'invalid trial length' using errcode = '22023'; end if;
  if p_owner is null or p_identity_hmac is null or p_identity_hmac !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' or p_days is null then
    raise exception 'owner, identity fingerprint and trial length required' using errcode='22023';
  end if;
  -- Account closure uses this same subject guard. A grant must either finish
  -- before closure detaches it, or observe closure and leave no attached row.
  perform internal.lock_evidence_subject(p_owner);
  -- Concurrent grants for one identity serialise here; the loser sees the claim.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(p_identity_hmac, ''), 2701));
  if not exists (select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active trial owner required' using errcode='42501';
  end if;
  if exists (select 1 from private.trial_identities t where t.identity_hmac = p_identity_hmac) then
    return jsonb_build_object('granted', false, 'reason', 'identity_already_used');
  end if;
  -- Banned identities (trust-governance.sql) get no trial while the ban is kept.
  if exists (select 1 from private.banned_identities b where b.identity_hmac = p_identity_hmac and b.retain_until>clock_timestamp()) then
    return jsonb_build_object('granted', false, 'reason', 'identity_banned');
  end if;
  insert into private.entitlements (owner_id, source, slot_capacity, max_photos, max_videos, starts_at, ends_at)
  values (p_owner, 'intro_trial', 1, 10, 1, statement_timestamp(), statement_timestamp() + make_interval(days => p_days))
  returning id into ent;
  insert into private.trial_identities (identity_hmac, owner_id, entitlement_id) values (p_identity_hmac, p_owner, ent);
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  -- The fingerprint lives only in trial_identities (DEC-27); other copies would
  -- outlive its purge, so effects are keyed by the trial's entitlement.
  values ('trial_started', ent, p_owner, 'trial_started:' || ent);
  return jsonb_build_object('granted', true, 'entitlement_id', ent);
end;
$$;
revoke all on function internal.grant_intro_trial(uuid, text, integer) from public, anon, authenticated, service_role;
-- Raw core helper has no client/service EXECUTE; trusted derived commands call it as owner.
-- Raw API driver lives only in fixture-core-drivers.sql, excluded from target.

-- Server-only sweep (DEC-27): delete detached trial fingerprints whose 3-year
-- period has ended. Live accounts' fingerprints have no deadline.
create function internal.purge_expired_trial_identities(p_limit integer)
returns integer language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  with due as (
    select t.identity_hmac from private.trial_identities t
    where t.retain_until <= statement_timestamp()
    order by t.retain_until limit p_limit
    for update skip locked
  )
  delete from private.trial_identities t using due where t.identity_hmac = due.identity_hmac;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function internal.purge_expired_trial_identities(integer) from public, anon, authenticated, service_role;
grant execute on function internal.purge_expired_trial_identities(integer) to service_role;
create function api.purge_expired_trial_identities(p_limit integer)
returns integer language sql security invoker set search_path = pg_catalog as $$
  select internal.purge_expired_trial_identities(p_limit);
$$;
revoke all on function api.purge_expired_trial_identities(integer) from public, anon, authenticated, service_role;
grant execute on function api.purge_expired_trial_identities(integer) to service_role;

-- Server-only reversal (staff authority and AAL2 binding are BF-08). One commit:
-- payment status, entitlement or window revocation, activation release, outbox.
create function internal.reverse_payment(p_payment_id uuid, p_kind text, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare pay private.payments; released integer := 0; payment_owner uuid;
begin
  if p_kind not in ('refunded', 'chargeback') or length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'reversal kind and audit reason required' using errcode = '22023';
  end if;
  select p.owner_id into payment_owner from private.payments p where p.id=p_payment_id;
  if payment_owner is not null then perform internal.lock_evidence_subject(payment_owner); end if;
  select * into pay from private.payments p where p.id = p_payment_id for update;
  if not found or pay.status <> 'complete' then
    raise exception 'only completed payments can be reversed' using errcode = '22023';
  end if;
  -- Activation normally takes post -> entitlement. Never WAIT in the reverse
  -- order: fence the entitlement and acquire the current affected posts NOWAIT,
  -- or return an explicit retry before any financial/domain mutation.
  begin
    perform e.id from private.entitlements e where e.payment_id=pay.id order by e.id for update nowait;
    perform p.id from private.posts p where p.id=pay.target_post_id or p.id in
      (select a.post_id from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
        where e.payment_id=pay.id and a.released_at is null)
      order by p.id for update of p nowait;
  exception when lock_not_available then
    raise exception 'funded posts are busy; retry reversal' using errcode='PT409';
  end;
  update private.payments set status = p_kind, fulfillment_status='reversed', status_changed_at = statement_timestamp() where id = pay.id;
  update private.entitlements set status = 'revoked', revoked_reason = 'payment_' || p_kind where payment_id = pay.id;
  update private.post_activations a set released_at = statement_timestamp(), release_reason = 'payment_reversed'
  from private.entitlements e where e.id = a.entitlement_id and e.payment_id = pay.id and a.released_at is null;
  get diagnostics released = row_count;
  update private.post_addon_windows set revoked_at = statement_timestamp() where payment_id = pay.id and revoked_at is null;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_reversed:' || pay.id);
  return jsonb_build_object('status', p_kind, 'released_activations', released);
end;
$$;
revoke all on function internal.reverse_payment(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function internal.reverse_payment(uuid, text, text) to service_role;
create function api.reverse_payment(p_payment_id uuid, p_kind text, p_reason text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.reverse_payment(p_payment_id, p_kind, p_reason);
$$;
revoke all on function api.reverse_payment(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function api.reverse_payment(uuid, text, text) to service_role;

-- Live catalogue carried over unchanged (DEC-24; source plans/pricing.ts read
-- 14 October 2026). Every plan allows 10 photos and 1 video per post.
-- Explicit reviewed retail/multi purchase capabilities; free/trial defaults remain empty.
insert into private.plan_versions (id, plan_code, version, area, label, price_cents, duration_days, slot_capacity,
  activations_per_period, max_photos, max_videos, addon_capabilities)
select case seed.plan_code||'@'||seed.version::text when 'market_30d@1' then '00420f8c-0ac1-4828-83c5-d547d862fc8f'::uuid when 'market_90d@1' then '94e38eb4-0b53-46a0-b4c4-26ff01c8a7e5'::uuid when 'market_180d@1' then 'c253bdb4-a6df-4b50-9581-c1181b1089f9'::uuid when 'business_30d@1' then 'e85d90ef-6f4c-412d-9f42-3c3e095dd23f'::uuid when 'business_90d@1' then '476179da-2247-4585-97c0-cffbcb06eec0'::uuid when 'business_180d@1' then '043d20ce-a7e1-420d-9770-848b781e76a6'::uuid when 'tourism_30d@1' then '8171ae1a-80d5-44e5-afe4-6345d600b9a7'::uuid when 'tourism_90d@1' then '838db9d2-9dff-41a8-99a3-c6d2673dc06f'::uuid when 'tourism_180d@1' then '9ad6cea5-e50d-4ef0-844c-8e2c25c82007'::uuid when 'multi_10_90d@1' then '0ff0318d-255b-4a97-989f-a2c77c68f7b5'::uuid when 'multi_10_180d@1' then 'b5a2624d-fc54-4a6d-b2c3-d952b130d40a'::uuid when 'multi_25_90d@1' then '0a728e91-8646-4c32-9a22-ae93f80c05b5'::uuid when 'multi_25_180d@1' then '62ae9cea-a942-4713-b9c8-00d9f6e84cc9'::uuid when 'multi_50_90d@1' then 'bcea355c-5d2c-435f-bd1c-afd7061fb90e'::uuid when 'multi_50_180d@1' then '043a5448-0c8f-4cf3-9c3b-972c76d7643f'::uuid when 'multi_100_90d@1' then '74ba6bde-0fc8-45d2-93c9-49c38b43f81a'::uuid when 'multi_100_180d@1' then 'bb63a08d-7238-4f14-be72-2f81fd333937'::uuid else null end,seed.*,array['boost','featured','urgent']::text[]
from (values
  ('market_30d', 1, 'market', 'Mzansi Market — 30 Days', 5000, 30, 1, 10, 10, 1),
  ('market_90d', 1, 'market', 'Mzansi Market — 90 Days', 14000, 90, 1, 10, 10, 1),
  ('market_180d', 1, 'market', 'Mzansi Market — 180 Days', 25000, 180, 1, 10, 10, 1),
  ('business_30d', 1, 'business', 'Mzansi Business — 30 Days', 5000, 30, 1, 10, 10, 1),
  ('business_90d', 1, 'business', 'Mzansi Business — 90 Days', 14000, 90, 1, 10, 10, 1),
  ('business_180d', 1, 'business', 'Mzansi Business — 180 Days', 25000, 180, 1, 10, 10, 1),
  ('tourism_30d', 1, 'tourism_events', 'Tourism — 30 Days', 5000, 30, 1, 10, 10, 1),
  ('tourism_90d', 1, 'tourism_events', 'Tourism — 90 Days', 14000, 90, 1, 10, 10, 1),
  ('tourism_180d', 1, 'tourism_events', 'Tourism — 180 Days', 25000, 180, 1, 10, 10, 1),
  ('multi_10_90d', 1, null, 'Multi-listing — 10 slots, 90 days', 120000, 90, 10, 20, 10, 1),
  ('multi_10_180d', 1, null, 'Multi-listing — 10 slots, 180 days', 215000, 180, 10, 20, 10, 1),
  ('multi_25_90d', 1, null, 'Multi-listing — 25 slots, 90 days', 270000, 90, 25, 50, 10, 1),
  ('multi_25_180d', 1, null, 'Multi-listing — 25 slots, 180 days', 485000, 180, 25, 50, 10, 1),
  ('multi_50_90d', 1, null, 'Multi-listing — 50 slots, 90 days', 500000, 90, 50, 100, 10, 1),
  ('multi_50_180d', 1, null, 'Multi-listing — 50 slots, 180 days', 900000, 180, 50, 100, 10, 1),
  ('multi_100_90d', 1, null, 'Multi-listing — 100 slots, 90 days', 900000, 90, 100, 200, 10, 1),
  ('multi_100_180d', 1, null, 'Multi-listing — 100 slots, 180 days', 1600000, 180, 100, 200, 10, 1)) as seed(plan_code, version, area, label, price_cents, duration_days, slot_capacity,
  activations_per_period, max_photos, max_videos);
insert into private.addon_versions (id, kind, version, days, price_cents)
select case seed.kind||'@'||seed.version::text when 'boost@1' then '7a8e430b-5d1f-4f3c-a207-b87bad2302cc'::uuid when 'featured@1' then 'b55276f4-a110-4b9d-acbe-aebe0fc52125'::uuid when 'urgent@1' then '8b1d0c70-8885-4800-b945-41ba3d8d2af4'::uuid else null end,seed.* from (values ('boost', 1, 7, 1500), ('featured', 1, 7, 2500), ('urgent', 1, 7, 1000)) as seed(kind,version,days,price_cents);

-- Source: docs/backend-foundation/prototypes/listing-attributes.sql
-- Canonical listing attribute persistence. Registry is private, seeded reference data.
alter table private.listing_details add column attributes jsonb not null default '{}'::jsonb
  check (jsonb_typeof(attributes)='object' and octet_length(attributes::text)<=16384),
  add column attributes_version integer not null default 1 references private.reference_catalog_versions(version);

create function internal.validate_attribute_value(p_rule jsonb,p_value jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare kind text:=p_rule->>'type'; text_value text; n numeric; result jsonb:='[]'::jsonb;
  item jsonb; normalized jsonb; units integer; parsed date;
begin
  if p_value is null or jsonb_typeof(p_value)='null' then raise exception 'attribute value required' using errcode='22023'; end if;
  if kind='string' then
    if jsonb_typeof(p_value)<>'string' then raise exception 'string attribute required' using errcode='22023'; end if;
    text_value:=p_value #>> '{}';
    if p_rule ? 'enum' then
      if not(p_rule->'enum' @> jsonb_build_array(text_value)) then raise exception 'invalid attribute choice' using errcode='22023'; end if;
    else
      text_value:=btrim(text_value,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
    end if;
    select coalesce(sum(case when c='' then 0 when octet_length(c)>3 then 2 else 1 end),0) into units from regexp_split_to_table(text_value,'') c;
    if (p_rule ? 'minLength' and units<(p_rule->>'minLength')::integer)
      or (p_rule ? 'maxLength' and units>(p_rule->>'maxLength')::integer) then
      raise exception 'attribute text outside bounds' using errcode='22023';
    end if;
    if p_rule->>'format'='date' then
      if text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(text_value,4)='0000' then raise exception 'valid date required' using errcode='22023'; end if;
      begin parsed:=text_value::date;
      exception when invalid_datetime_format or datetime_field_overflow then raise exception 'valid date required' using errcode='22023'; end;
      if to_char(parsed,'YYYY-MM-DD')<>text_value then raise exception 'valid date required' using errcode='22023'; end if;
    end if;
    return to_jsonb(text_value);
  elsif kind in ('number','integer') then
    if jsonb_typeof(p_value)<>'number' then raise exception 'numeric attribute required' using errcode='22023'; end if;
    n:=(p_value #>> '{}')::numeric;
    if (kind='integer' and mod(n,1)<>0) or (p_rule ? 'minimum' and n<(p_rule->>'minimum')::numeric)
      or (p_rule ? 'maximum' and n>(p_rule->>'maximum')::numeric) then raise exception 'attribute number outside bounds' using errcode='22023'; end if;
    return p_value;
  elsif kind='boolean' then
    if jsonb_typeof(p_value)<>'boolean' then raise exception 'boolean attribute required' using errcode='22023'; end if;
    return p_value;
  elsif kind='array' then
    if jsonb_typeof(p_value)<>'array' then raise exception 'array attribute required' using errcode='22023'; end if;
    if (p_rule ? 'minItems' and jsonb_array_length(p_value)<(p_rule->>'minItems')::integer)
      or (p_rule ? 'maxItems' and jsonb_array_length(p_value)>(p_rule->>'maxItems')::integer) then raise exception 'attribute list outside bounds' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_value) loop
      normalized:=internal.validate_attribute_value(p_rule->'items',item);
      if result @> jsonb_build_array(normalized) then raise exception 'duplicate attribute choice' using errcode='22023'; end if;
      result:=result||jsonb_build_array(normalized);
    end loop;
    return result;
  end if;
  raise exception 'unsupported attribute rule' using errcode='22023';
end;
$$;
revoke all on function internal.validate_attribute_value(jsonb,jsonb) from public,anon,authenticated,service_role;

create function internal.validate_listing_attributes(p_category text,p_attributes jsonb,p_complete boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare field private.category_fields; result jsonb:='{}'::jsonb; rule jsonb; active boolean;
begin
  if jsonb_typeof(p_attributes) is distinct from 'object' or octet_length(p_attributes::text)>16384 then raise exception 'attribute object required' using errcode='22023'; end if;
  if not exists(select 1 from private.categories c where c.key=p_category and c.kind='listing') then
    raise exception 'unknown listing category' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_attributes) k where not exists(select 1 from private.category_fields f where f.category_key=p_category and f.key=k)) then
    raise exception 'unknown attribute key' using errcode='22023';
  end if;
  for field in select f.* from private.category_fields f where f.category_key=p_category order by f.sort_order loop
    active:=field.depends_on is null or (p_attributes ? field.depends_on and
      (field.depends_on_values is null or field.depends_on_values @> jsonb_build_array(p_attributes->>field.depends_on)));
    if not active and p_attributes ? field.key then raise exception 'inactive attribute field' using errcode='22023'; end if;
    if active and field.required and p_complete and not(p_attributes ? field.key) then raise exception 'required attribute missing' using errcode='22023'; end if;
    if active and p_attributes ? field.key then
      rule:=field.validation;
      if field.dynamic_maximum='south_african_year_plus_one' then
        rule:=rule||jsonb_build_object('maximum',extract(year from statement_timestamp() at time zone 'Africa/Johannesburg')::integer+1);
      elsif field.dynamic_maximum is not null then raise exception 'unsupported dynamic attribute rule' using errcode='22023'; end if;
      result:=result||jsonb_build_object(field.key,internal.validate_attribute_value(rule,p_attributes->field.key));
    end if;
  end loop;
  return result;
end;
$$;
revoke all on function internal.validate_listing_attributes(text,jsonb,boolean) from public,anon,authenticated,service_role;

create function internal.listing_attributes_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare category text;
begin
  select p.category_key into category from private.posts p where p.id=new.post_id;
  if new.attributes_version<>1 then raise exception 'unsupported attribute version' using errcode='23514'; end if;
  new.attributes:=internal.validate_listing_attributes(category,new.attributes,false);
  return new;
end;
$$;
revoke all on function internal.listing_attributes_guard() from public,anon,authenticated,service_role;
create trigger listing_attributes_valid before insert or update on private.listing_details for each row execute function internal.listing_attributes_guard();

-- A parent category change must not leave attributes from a different schema.
-- Deferred validation permits an intentional same-transaction replacement.
create function internal.listing_attributes_category_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare post private.posts; attrs jsonb;
begin
  select p.* into post from private.posts p where p.id=new.id for update;
  if not found or post.kind<>'listing' then return null; end if;
  select d.attributes into attrs from private.listing_details d where d.post_id=post.id;
  if found then perform internal.validate_listing_attributes(post.category_key,attrs,false); end if;
  return null;
end;
$$;
revoke all on function internal.listing_attributes_category_guard() from public,anon,authenticated,service_role;
create constraint trigger listing_attributes_category after insert or update on private.posts
  deferrable initially deferred for each row execute function internal.listing_attributes_category_guard();

create function internal.save_listing_attributes(p_post_id uuid,p_expected_revision integer,p_attributes jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post private.posts; normalized jsonb;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  select p.* into post from private.posts p where p.id=p_post_id and p.owner_id=actor and p.kind='listing' for update;
  if not found or post.status not in ('draft','rejected','paused') then raise exception 'editable listing unavailable' using errcode='22023'; end if;
  if post.revision is distinct from p_expected_revision then raise exception 'listing changed' using errcode='PT409'; end if;
  normalized:=internal.validate_listing_attributes(post.category_key,p_attributes,false);
  update private.listing_details set attributes=normalized,attributes_version=1 where post_id=post.id;
  update private.posts set revision=revision+1,content_updated_at=statement_timestamp() where id=post.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id',post.id,'revision',post.revision+1,'attributes_version',1,'attributes',normalized);
end;
$$;
revoke all on function internal.save_listing_attributes(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.save_listing_attributes(uuid,integer,jsonb) to authenticated;
create function api.save_listing_attributes(p_post_id uuid,p_expected_revision integer,p_attributes jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.save_listing_attributes(p_post_id,p_expected_revision,p_attributes); $$;
revoke all on function api.save_listing_attributes(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function api.save_listing_attributes(uuid,integer,jsonb) to authenticated;

create function internal.get_listing_attributes(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'revision',p.revision,'category_key',p.category_key,'attributes_version',d.attributes_version,'attributes',d.attributes)
    into result from private.posts p join private.listing_details d on d.post_id=p.id where p.id=p_post_id and p.owner_id=actor and p.kind='listing';
  return result;
end;
$$;
revoke all on function internal.get_listing_attributes(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_listing_attributes(uuid) to authenticated;
create function api.get_listing_attributes(p_post_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.get_listing_attributes(p_post_id); $$;
revoke all on function api.get_listing_attributes(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_listing_attributes(uuid) to authenticated;

-- Source: docs/backend-foundation/prototypes/trust-governance.sql
-- BF-08 trust, governance, retention and object journal candidate.
-- Staff authority is re-derived on every call from live rows: non-anonymous
-- AAL2 JWT, live auth session, unbanned account, active role with an explicit
-- capability, and (for sensitive capabilities) a TOTP verification within 15
-- minutes. Evidence bytes never pass through the database; it holds the
-- upload journal, opaque artifact ids, durable access audit and deletion state.

create table private.staff_capabilities (
  role text not null check (role in ('moderator', 'governor', 'admin')),
  capability text not null check (capability ~ '^[a-z_]+:[a-z_]+$'),
  requires_recent_mfa boolean not null default false,
  primary key (role, capability)
);
insert into private.staff_capabilities (role, capability, requires_recent_mfa) values
  ('moderator', 'queue:view', false),
  ('moderator', 'case:claim', false),
  ('moderator', 'evidence:view', true),
  ('moderator', 'verification:decide_routine', true),
  ('governor', 'queue:view', false),
  ('governor', 'case:claim', false),
  ('governor', 'evidence:view', true),
  ('governor', 'verification:decide_routine', true),
  ('governor', 'decision:propose', true),
  ('governor', 'decision:approve', true),
  ('governor', 'decision:withdraw', true),
  ('governor', 'legal_hold:manage', true),
  ('admin', 'queue:view', false),
  ('admin', 'decision:propose', true),
  ('admin', 'decision:approve', true),
  ('admin', 'decision:withdraw', true),
  ('admin', 'legal_hold:manage', true),
  ('admin', 'role:manage', true);

create table private.staff_roles (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null check (role in ('moderator', 'governor', 'admin')),
  granted_by uuid references auth.users (id) on delete restrict,
  granted_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index staff_roles_one_active_idx on private.staff_roles (user_id) where revoked_at is null;

-- The last active administrator cannot be revoked or demoted.
create function internal.staff_last_admin_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if old.role = 'admin' and old.revoked_at is null
    and (new.revoked_at is not null or new.role <> 'admin')
    and not exists (select 1 from private.staff_roles r where r.role = 'admin' and r.revoked_at is null and r.id <> old.id) then
    raise exception 'the last active administrator cannot be removed' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.staff_last_admin_guard() from public, anon, authenticated, service_role;
create trigger staff_last_admin before update on private.staff_roles
  for each row execute function internal.staff_last_admin_guard();

create function internal.staff_actor(p_capability text)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := auth.uid();
  claims jsonb := auth.jwt();
  needs_mfa boolean;
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean, false) or claims->>'aal' is distinct from 'aal2' then
    raise exception 'staff session with second factor required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.sessions s where s.id::text = claims->>'session_id' and s.user_id = actor
      and s.aal = 'aal2' and (s.not_after is null or s.not_after > clock_timestamp())) then
    raise exception 'live staff session required' using errcode = '42501';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = actor) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  select c.requires_recent_mfa into needs_mfa
  from private.staff_roles r join private.staff_capabilities c on c.role = r.role
  where r.user_id = actor and r.revoked_at is null and c.capability = p_capability;
  if not found then raise exception 'capability not granted' using errcode = '42501'; end if;
  if needs_mfa and not exists (
      select 1 from jsonb_array_elements(coalesce(claims->'amr', '[]')) a
      where a->>'method' = 'totp' and (a->>'timestamp')::bigint >= extract(epoch from clock_timestamp() - interval '15 minutes')) then
    raise exception 'recent second-factor verification required' using errcode = '42501';
  end if;
  return actor;
end;
$$;
revoke all on function internal.staff_actor(text) from public, anon, authenticated, service_role;
grant execute on function internal.staff_actor(text) to authenticated;

-- Evidence cases and the upload journal. Object keys are generated here, never
-- accepted from a client, and never returned to staff browsers.
create table private.evidence_cases (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  subject_id uuid not null references auth.users (id) on delete restrict,
  kind text not null check (kind in ('kyc', 'business', 'restriction')),
  status text not null default 'open' check (status in ('open', 'decided', 'closed')),
  claimed_by uuid references auth.users (id) on delete restrict,
  claim_expires_at timestamptz,
  claim_generation bigint not null default 0 check(claim_generation>=0),
  claim_nonce uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  unique(id,subject_id),
  check ((claimed_by is null and claim_expires_at is null and claim_nonce is null)
    or (claimed_by is not null and claim_expires_at is not null and claim_nonce is not null and claim_generation>0)),
  check (status='open' or claimed_by is null)
);

create table private.evidence_artifacts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  case_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete restrict,
  purpose text not null check (purpose in ('id_front', 'id_back', 'selfie', 'proof_of_address', 'registration')),
  object_key text not null unique,
  state text not null default 'intent'
    check (state in ('intent', 'uploaded', 'clean', 'rejected', 'cleanup_required', 'deleted')),
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer check (size_bytes between 1 and 20000000),
  created_at timestamptz not null default statement_timestamp(),
  state_changed_at timestamptz not null default statement_timestamp(),
  retain_until timestamptz,
  deleted_at timestamptz,
  foreign key(case_id,owner_id) references private.evidence_cases(id,subject_id) on delete restrict,
  check ((state in ('intent', 'cleanup_required', 'deleted', 'rejected')) or sha256 is not null),
  check ((state = 'deleted') = (deleted_at is not null))
);
create index evidence_artifacts_due_idx on private.evidence_artifacts (retain_until) where state = 'clean';
create index evidence_artifacts_intent_idx on private.evidence_artifacts (created_at) where state = 'intent';
create index evidence_artifacts_case_idx on private.evidence_artifacts(case_id,id);
create index evidence_cases_subject_idx on private.evidence_cases(subject_id,id);

-- Evidence commands share subject -> case -> artifact lock order. This includes
-- account closure and holds; no command may acquire an artifact first.
create function internal.lock_evidence_subject(p_subject uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_subject is null then raise exception 'evidence subject required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_subject::text,2408));
end;
$$;
revoke all on function internal.lock_evidence_subject(uuid) from public,anon,authenticated,service_role;

create function internal.evidence_case_identity_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.subject_id,new.kind,new.created_at) is distinct from (old.id,old.subject_id,old.kind,old.created_at) then
    raise exception 'evidence case identity is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.evidence_case_identity_guard() from public,anon,authenticated,service_role;
create trigger evidence_case_identity before update on private.evidence_cases
  for each row execute function internal.evidence_case_identity_guard();

-- Every mutation of the reviewed artifact set invalidates an older proposal.
-- Retention clocks alone are operational and do not change reviewed content.
create function internal.evidence_artifact_submission_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare subject uuid; case_id uuid; c private.evidence_cases; relevant boolean;
begin
  subject:=case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  case_id:=case when tg_op='DELETE' then old.case_id else new.case_id end;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=case_id and e.subject_id=subject for update;
  if not found then raise exception 'artifact subject must match case' using errcode='23514'; end if;
  if tg_op='INSERT' then
    relevant:=true;
    if c.status<>'open' or exists(select 1 from private.account_closures x where x.user_id=subject) then
      raise exception 'case no longer accepts evidence' using errcode='22023';
    end if;
  elsif tg_op='DELETE' then relevant:=true;
  else
    relevant:=(new.state,new.sha256,new.size_bytes) is distinct from (old.state,old.sha256,old.size_bytes);
    if relevant and new.state in ('uploaded','clean','rejected') and
      (c.status<>'open' or exists(select 1 from private.account_closures x where x.user_id=subject)) then
      raise exception 'case no longer accepts evidence' using errcode='22023';
    end if;
  end if;
  if relevant then
    update private.evidence_cases set version=version+1 where id=c.id and version<2147483647;
    if not found then raise exception 'case revision exhausted' using errcode='22023'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function internal.evidence_artifact_submission_guard() from public,anon,authenticated,service_role;
create trigger evidence_artifact_submission before insert or update or delete on private.evidence_artifacts
  for each row execute function internal.evidence_artifact_submission_guard();

create function internal.evidence_case_snapshot(p_case uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'purpose',a.purpose,
    'object_key',a.object_key,'state',a.state,'sha256',a.sha256,'size_bytes',a.size_bytes)
    order by a.id),'[]'::jsonb)
  from private.evidence_artifacts a where a.case_id=p_case;
$$;
revoke all on function internal.evidence_case_snapshot(uuid) from public,anon,authenticated,service_role;

-- Allowed journal transitions only; deleted is terminal.
create function internal.evidence_artifact_transition_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if (new.id, new.case_id, new.owner_id, new.purpose, new.object_key) is distinct from
     (old.id, old.case_id, old.owner_id, old.purpose, old.object_key) then
    raise exception 'artifact identity is immutable' using errcode = '23514';
  end if;
  if new.state <> old.state and not (
      (old.state = 'intent' and new.state in ('uploaded', 'cleanup_required'))
      or (old.state = 'uploaded' and new.state in ('clean', 'rejected', 'cleanup_required'))
      or (old.state in ('clean', 'rejected') and new.state = 'cleanup_required')
      or (old.state = 'cleanup_required' and new.state = 'deleted')) then
    raise exception 'invalid artifact transition % -> %', old.state, new.state using errcode = '23514';
  end if;
  if old.sha256 is not null and new.sha256 is distinct from old.sha256 then
    raise exception 'artifact digest is immutable' using errcode = '23514';
  end if;
  new.state_changed_at := case when new.state <> old.state then statement_timestamp() else old.state_changed_at end;
  return new;
end;
$$;
revoke all on function internal.evidence_artifact_transition_guard() from public, anon, authenticated, service_role;
create trigger evidence_artifact_transition before update on private.evidence_artifacts
  for each row execute function internal.evidence_artifact_transition_guard();

create table private.legal_holds (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  subject_id uuid not null references auth.users (id) on delete restrict,
  reason text not null check (length(reason) between 5 and 500),
  placed_by uuid not null references auth.users (id) on delete restrict,
  placed_at timestamptz not null default statement_timestamp(),
  released_by uuid references auth.users (id) on delete restrict,
  released_at timestamptz,
  check ((released_at is null) = (released_by is null))
);
create index legal_holds_active_idx on private.legal_holds (subject_id) where released_at is null;

-- Append-only, written in the same transaction as the read it records.
create table private.evidence_access_log (
  id bigint generated always as identity primary key,
  staff_id uuid not null references auth.users (id) on delete restrict,
  case_id uuid not null references private.evidence_cases (id) on delete restrict,
  purpose text not null,
  case_version integer not null check(case_version>0),
  claim_generation bigint not null check(claim_generation>0),
  artifact_ids uuid[] not null,
  accessed_at timestamptz not null default statement_timestamp()
);
create table private.decisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  case_id uuid not null references private.evidence_cases (id) on delete restrict,
  action text not null check (action in ('approve_override', 'reject', 'restrict_account')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2048),
  case_version integer not null check(case_version>0),
  reviewed_snapshot jsonb not null check(jsonb_typeof(reviewed_snapshot)='array'),
  proposed_by uuid not null references auth.users (id) on delete restrict,
  proposed_at timestamptz not null default statement_timestamp(),
  approved_by uuid references auth.users (id) on delete restrict,
  approved_at timestamptz,
  withdrawn_by uuid references auth.users(id) on delete restrict,
  withdrawn_at timestamptz,
  withdrawn_case_version integer check(withdrawn_case_version>0),
  withdrawal_reason text,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'withdrawn')),
  check ((status='approved' and approved_by is not null and approved_at is not null)
    or (status<>'approved' and approved_by is null and approved_at is null)),
  check ((status='withdrawn' and withdrawn_by is not null and withdrawn_at is not null
      and withdrawn_case_version is not null and withdrawal_reason is not null)
    or (status<>'withdrawn' and withdrawn_by is null and withdrawn_at is null
      and withdrawn_case_version is null and withdrawal_reason is null)),
  check (approved_by is distinct from proposed_by)
);
create unique index decisions_one_open_idx on private.decisions (case_id) where status = 'proposed';

create function internal.append_only_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end;
$$;
revoke all on function internal.append_only_guard() from public, anon, authenticated, service_role;
create trigger evidence_access_log_append_only before update or delete on private.evidence_access_log
  for each row execute function internal.append_only_guard();
create trigger evidence_access_log_no_truncate before truncate on private.evidence_access_log
  for each statement execute function internal.append_only_guard();

-- A decision's subject, action, payload and bound case version never change after proposal.
create function internal.decision_binding_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then raise exception 'decisions are retained' using errcode = '23514'; end if;
  if (new.id,new.case_id, new.action, new.payload, new.case_version, new.reviewed_snapshot, new.proposed_by, new.proposed_at)
     is distinct from (old.id,old.case_id, old.action, old.payload, old.case_version, old.reviewed_snapshot, old.proposed_by, old.proposed_at)
    or old.status <> 'proposed' then
    raise exception 'decision is bound to its proposal' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.decision_binding_guard() from public, anon, authenticated, service_role;
create trigger decision_binding before update or delete on private.decisions
  for each row execute function internal.decision_binding_guard();

-- DEC-22: identity evidence is kept while the account exists and deleted 90
-- days after the account is deleted. The auth user row is retained
-- (anonymised by the deletion flow) until then, because evidence and audit
-- rows restrict its removal.
create table private.account_closures (
  user_id uuid primary key references auth.users (id) on delete restrict,
  closed_at timestamptz not null default statement_timestamp(),
  evidence_delete_after timestamptz not null,
  check (evidence_delete_after = closed_at + interval '90 days')
);

alter table private.staff_capabilities enable row level security;
alter table private.staff_roles enable row level security;
alter table private.evidence_cases enable row level security;
alter table private.evidence_artifacts enable row level security;
alter table private.legal_holds enable row level security;
alter table private.evidence_access_log enable row level security;
alter table private.decisions enable row level security;
alter table private.account_closures enable row level security;
revoke all on private.account_closures from public, anon, authenticated, service_role;

-- Current account authority, shared by owner commands and public resource reads.
-- Approved restrict_account decisions fail closed until an explicit reviewed
-- lift/appeal model exists. Proposals and withdrawals have no authority.
create index decisions_approved_restriction_idx on private.decisions(case_id)
  where status='approved' and action='restrict_account';
create view private.current_account_access with (security_invoker=true) as
  select u.id from auth.users u
  where u.is_anonymous is false and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=statement_timestamp())
    and not exists(select 1 from private.account_closures c where c.user_id=u.id)
    and not exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
      where c.subject_id=u.id and d.status='approved' and d.action='restrict_account');
revoke all on private.current_account_access from public,anon,authenticated,service_role;

create or replace function internal.price_draft_actor()
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt();
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean,false)
    or not exists(select 1 from private.current_account_access u where u.id=actor) then
    raise exception 'active authenticated member required' using errcode='42501';
  end if;
  if not exists(select 1 from auth.sessions s where s.id::text=claims->>'session_id'
    and s.user_id=actor and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'live session required' using errcode='42501';
  end if;
  return actor;
end;
$$;
revoke all on function internal.price_draft_actor() from public,anon,authenticated,service_role;
grant execute on function internal.price_draft_actor() to authenticated;
revoke all on private.staff_capabilities, private.staff_roles, private.evidence_cases, private.evidence_artifacts,
  private.legal_holds, private.evidence_access_log, private.decisions
  from public, anon, authenticated, service_role;

-- Owner: open an upload intent before any bytes are written. The server-side
-- Worker then writes encrypted bytes to exactly this key.
create function internal.begin_evidence_upload(p_case_id uuid, p_purpose text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); art private.evidence_artifacts;
begin
  perform internal.lock_evidence_subject(actor);
  actor:=internal.price_draft_actor();
  if exists(select 1 from private.evidence_cases c where c.id=p_case_id and c.subject_id=actor and c.kind='kyc')
    and p_purpose in('id_front','id_back','selfie') then
    if exists(select 1 from private.accepted_identity_facts f where f.owner_id=actor) then
      raise exception 'accepted identity requires authorised resubmission' using errcode='PT409'; end if;
    if exists(select 1 from private.decisions d where d.case_id=p_case_id and d.status='proposed'
      and d.action='approve_override' and d.payload ? 'identity_submission_id') then
      raise exception 'independent identity review is pending' using errcode='PT409'; end if;
  end if;
  perform c.id from private.evidence_cases c where c.id=p_case_id and c.subject_id=actor and c.status='open'
    and c.kind in('kyc','business') for update;
  if not found then
    raise exception 'case not open for this member' using errcode = '22023';
  end if;
  if exists (select 1 from private.account_closures x where x.user_id = actor) then
    raise exception 'account is closed' using errcode = '42501';
  end if;
  if (select count(*) from private.evidence_artifacts a where a.case_id = p_case_id and a.state = 'intent') >= 5 then
    raise exception 'too many unfinished uploads' using errcode = 'PT429';
  end if;
  insert into private.evidence_artifacts (case_id, owner_id, purpose, object_key)
  values (p_case_id, actor, p_purpose, 'evidence/' || p_case_id || '/' || pg_catalog.gen_random_uuid())
  returning * into art;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('artifact_id', art.id, 'state', art.state);
end;
$$;
revoke all on function internal.begin_evidence_upload(uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.begin_evidence_upload(uuid, text) to authenticated;
create function api.begin_evidence_upload(p_case_id uuid, p_purpose text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.begin_evidence_upload(p_case_id, p_purpose);
$$;
revoke all on function api.begin_evidence_upload(uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.begin_evidence_upload(uuid, text) to authenticated;

-- Server: advance the journal (uploaded -> clean/rejected after scanning,
-- cleanup_required, deleted after the object store confirms deletion).
create function internal.advance_evidence_artifact(p_artifact_id uuid, p_state text, p_sha256 text, p_size integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare art private.evidence_artifacts; subject uuid; case_id uuid;
begin
  select a.owner_id,a.case_id into subject,case_id from private.evidence_artifacts a where a.id=p_artifact_id;
  if not found then raise exception 'artifact not found' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  perform c.id from private.evidence_cases c where c.id=case_id for update;
  select * into art from private.evidence_artifacts a where a.id = p_artifact_id for update;
  if not found then raise exception 'artifact not found' using errcode = '22023'; end if;
  if p_sha256 is not null and p_sha256 !~ '^[a-f0-9]{64}$'
    or p_size is not null and p_size not between 1 and 20000000 then
    raise exception 'valid digest and bounded size required' using errcode='22023';
  end if;
  if (p_sha256 is not null and art.sha256 is not null and p_sha256 is distinct from art.sha256)
    or (p_size is not null and art.size_bytes is not null and p_size is distinct from art.size_bytes) then
    raise exception 'artifact metadata conflicts with stored upload' using errcode='PT409';
  end if;
  if p_state = 'deleted' and exists (select 1 from private.legal_holds h
      where h.subject_id = art.owner_id and h.released_at is null) then
    raise exception 'legal hold blocks deletion' using errcode = '23514';
  end if;
  update private.evidence_artifacts set state = p_state,
    sha256 = coalesce(sha256, p_sha256), size_bytes = coalesce(size_bytes, p_size),
    deleted_at = case when p_state = 'deleted' then statement_timestamp() end
  where id = art.id returning * into art;
  return jsonb_build_object('artifact_id', art.id, 'state', art.state);
end;
$$;
revoke all on function internal.advance_evidence_artifact(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function internal.advance_evidence_artifact(uuid, text, text, integer) to service_role;
create function api.advance_evidence_artifact(p_artifact_id uuid, p_state text, p_sha256 text default null, p_size integer default null)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.advance_evidence_artifact(p_artifact_id, p_state, p_sha256, p_size);
$$;
revoke all on function api.advance_evidence_artifact(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function api.advance_evidence_artifact(uuid, text, text, integer) to service_role;

-- Server sweep: abandoned intents and expired, unheld evidence become
-- cleanup_required; the Worker deletes bytes and then marks them deleted.
-- Returns the object keys to delete (server only).
create function internal.claim_evidence_cleanup(p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare rows jsonb:='[]'::jsonb; candidate record; art private.evidence_artifacts;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'limit 1 to 500' using errcode = '22023'; end if;
  for candidate in
    select a.id,a.owner_id,a.case_id from private.evidence_artifacts a
    where ((a.state = 'intent' and a.created_at < statement_timestamp() - interval '1 hour')
        or (a.state in ('uploaded', 'clean', 'rejected') and a.retain_until <= statement_timestamp()))
      and not exists (select 1 from private.legal_holds h where h.subject_id = a.owner_id and h.released_at is null)
    order by a.owner_id,a.case_id,a.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    perform c.id from private.evidence_cases c where c.id=candidate.case_id for update skip locked;
    if not found then continue; end if;
    select a.* into art from private.evidence_artifacts a where a.id=candidate.id for update skip locked;
    if not found then continue; end if;
    -- Fresh checks after the shared lock order, including newly placed holds.
    if not ((art.state='intent' and art.created_at<statement_timestamp()-interval '1 hour')
      or (art.state in ('uploaded','clean','rejected') and art.retain_until<=statement_timestamp()))
      or exists(select 1 from private.legal_holds h where h.subject_id=art.owner_id and h.released_at is null) then continue; end if;
    update private.evidence_artifacts set state='cleanup_required' where id=art.id;
    rows:=rows||jsonb_build_array(jsonb_build_object('artifact_id',art.id,'object_key',art.object_key));
  end loop;
  return rows;
end;
$$;
revoke all on function internal.claim_evidence_cleanup(integer) from public, anon, authenticated, service_role;
grant execute on function internal.claim_evidence_cleanup(integer) to service_role;
create function api.claim_evidence_cleanup(p_limit integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.claim_evidence_cleanup(p_limit);
$$;
revoke all on function api.claim_evidence_cleanup(integer) from public, anon, authenticated, service_role;
grant execute on function api.claim_evidence_cleanup(integer) to service_role;

-- Staff: claim a case for review (never one's own; claims expire).
create function internal.claim_evidence_case(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('case:claim'); c private.evidence_cases; subject uuid;
begin
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id = p_case_id and e.status = 'open' for update;
  if not found then raise exception 'case not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('case:claim');
  if c.subject_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  if c.claimed_by is not null and c.claimed_by <> actor and c.claim_expires_at > clock_timestamp() then
    raise exception 'case claimed by another reviewer' using errcode = 'PT409';
  end if;
  update private.evidence_cases set claimed_by = actor, claim_expires_at = clock_timestamp() + interval '30 minutes',
    claim_generation=claim_generation+1,claim_nonce=pg_catalog.gen_random_uuid()
  where id = c.id and claim_generation<9223372036854775807 returning * into c;
  if not found then raise exception 'claim generation exhausted' using errcode='PT409'; end if;
  return jsonb_build_object('case_id', c.id, 'version', c.version,'claim_generation',c.claim_generation::text,
    'claim_nonce',c.claim_nonce,'claim_expires_at', c.claim_expires_at);
end;
$$;
revoke all on function internal.claim_evidence_case(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.claim_evidence_case(uuid) to authenticated;
create function api.claim_evidence_case(p_case_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.claim_evidence_case(p_case_id);
$$;
revoke all on function api.claim_evidence_case(uuid) from public, anon, authenticated, service_role;
grant execute on function api.claim_evidence_case(uuid) to authenticated;

create function internal.assert_evidence_claim(p_case private.evidence_cases,p_actor uuid,p_generation text,p_nonce uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_generation is null or p_generation !~ '^[1-9][0-9]{0,18}$' or p_nonce is null then
    raise exception 'current claim generation and nonce required' using errcode='22023';
  end if;
  if p_case.status<>'open' or p_case.subject_id=p_actor or p_case.claimed_by is distinct from p_actor
    or p_case.claim_generation::text is distinct from p_generation or p_case.claim_nonce is distinct from p_nonce
    or p_case.claim_expires_at is null or p_case.claim_expires_at<=clock_timestamp() then
    raise exception 'current live evidence claim required' using errcode='42501';
  end if;
end;
$$;
revoke all on function internal.assert_evidence_claim(private.evidence_cases,uuid,text,uuid) from public,anon,authenticated,service_role;

create function internal.renew_evidence_claim(p_case_id uuid,p_claim_generation text,p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('case:claim'); subject uuid; c private.evidence_cases;
begin
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_case_id for update;
  actor:=internal.staff_actor('case:claim');
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  update private.evidence_cases set claim_expires_at=clock_timestamp()+interval '30 minutes' where id=c.id returning * into c;
  return jsonb_build_object('case_id',c.id,'version',c.version,'claim_generation',c.claim_generation::text,
    'claim_nonce',c.claim_nonce,'claim_expires_at',c.claim_expires_at);
end;
$$;
revoke all on function internal.renew_evidence_claim(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.renew_evidence_claim(uuid,text,uuid) to authenticated;
create function api.renew_evidence_claim(p_case_id uuid,p_claim_generation text,p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.renew_evidence_claim(p_case_id,p_claim_generation,p_claim_nonce);
$$;
revoke all on function api.renew_evidence_claim(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function api.renew_evidence_claim(uuid,text,uuid) to authenticated;

-- Staff: evidence metadata for a claimed case. The access row commits with the
-- read or the read fails. Opaque ids only: no object keys, hashes or provider data.
create function internal.staff_evidence_metadata(p_case_id uuid,p_claim_generation text,p_claim_nonce uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('evidence:view'); c private.evidence_cases; items jsonb; ids uuid[]; subject uuid;
begin
  if p_purpose is null or p_purpose not in ('routine_review', 'override_review', 'appeal_review') then
    raise exception 'access purpose required' using errcode = '22023';
  end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id = p_case_id for update;
  if not found or c.status <> 'open' then raise exception 'case not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('evidence:view');
  if c.subject_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  select coalesce(jsonb_agg(jsonb_build_object('artifact_id', a.id, 'purpose', a.purpose, 'size_bytes', a.size_bytes,
      'uploaded_at', a.created_at) order by a.created_at), '[]'), coalesce(array_agg(a.id), '{}')
  into items, ids
  from private.evidence_artifacts a
  where a.case_id = c.id and a.state = 'clean'
    and (a.retain_until is null or a.retain_until > clock_timestamp());
  insert into private.evidence_access_log (staff_id, case_id, purpose,case_version,claim_generation,artifact_ids)
    values (actor,c.id,p_purpose,c.version,c.claim_generation,ids);
  return jsonb_build_object('case_id', c.id, 'version', c.version, 'artifacts', items);
end;
$$;
revoke all on function internal.staff_evidence_metadata(uuid,text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function internal.staff_evidence_metadata(uuid,text,uuid,text) to authenticated;
create function api.staff_evidence_metadata(p_case_id uuid,p_claim_generation text,p_claim_nonce uuid,p_purpose text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.staff_evidence_metadata(p_case_id,p_claim_generation,p_claim_nonce,p_purpose);
$$;
revoke all on function api.staff_evidence_metadata(uuid,text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function api.staff_evidence_metadata(uuid,text,uuid,text) to authenticated;

-- Two-person decisions bound to the reviewed case version.
create function internal.propose_decision(p_case_id uuid, p_expected_version integer, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('decision:propose'); c private.evidence_cases; d private.decisions; subject uuid;
begin
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 then
    raise exception 'positive expected case version required' using errcode='22023';
  end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id = p_case_id for update;
  if not found or c.status <> 'open' then raise exception 'case not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('decision:propose');
  if c.subject_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  if c.version <> p_expected_version then raise exception 'case changed since review' using errcode = 'PT409'; end if;
  insert into private.decisions (case_id, action, payload, case_version, reviewed_snapshot, proposed_by)
  values (c.id, p_action, coalesce(p_payload, '{}'), c.version, internal.evidence_case_snapshot(c.id), actor) returning * into d;
  return jsonb_build_object('decision_id', d.id, 'case_version', d.case_version);
end;
$$;
revoke all on function internal.propose_decision(uuid, integer, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.propose_decision(uuid, integer, text, jsonb) to authenticated;
create function api.propose_decision(p_case_id uuid, p_expected_version integer, p_action text, p_payload jsonb)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.propose_decision(p_case_id, p_expected_version, p_action, p_payload);
$$;
revoke all on function api.propose_decision(uuid, integer, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function api.propose_decision(uuid, integer, text, jsonb) to authenticated;

-- Withdraw an authored proposal, or recover another reviewer's obsolete one.
-- Finalized audit is immutable. Retries return the original result only for
-- the same current-authority actor and normalized reason; no second write.
create function internal.withdraw_decision(p_decision_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:withdraw'); subject uuid; case_id uuid;
  c private.evidence_cases; d private.decisions; reason text;
begin
  if p_expected_version is null or p_expected_version<1 then
    raise exception 'positive expected current case version required' using errcode='22023';
  end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode='22023';
  end if;
  select x.case_id,e.subject_id into case_id,subject
    from private.decisions x join private.evidence_cases e on e.id=x.case_id where x.id=p_decision_id;
  if not found then raise exception 'proposal unavailable' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=case_id for update;
  select x.* into d from private.decisions x where x.id=p_decision_id for update;
  if not found then raise exception 'proposal unavailable' using errcode='22023'; end if;
  actor:=internal.staff_actor('decision:withdraw');
  if actor=c.subject_id then raise exception 'self-review is not allowed' using errcode='42501'; end if;
  if d.status='withdrawn' then
    if d.withdrawn_by=actor and d.withdrawal_reason=reason then
      return jsonb_build_object('decision_id',d.id,'status','withdrawn');
    end if;
    raise exception 'withdrawal already finalized by a different request' using errcode='PT409';
  end if;
  if d.status<>'proposed' then raise exception 'only pending proposals can be withdrawn' using errcode='22023'; end if;
  if c.version is distinct from p_expected_version then raise exception 'case changed since review' using errcode='PT409'; end if;
  if d.proposed_by<>actor and c.status='open' and c.version=d.case_version
    and internal.evidence_case_snapshot(c.id)=d.reviewed_snapshot then
    raise exception 'another reviewer may withdraw only an obsolete proposal' using errcode='42501';
  end if;
  update private.decisions set status='withdrawn',withdrawn_by=actor,withdrawn_at=clock_timestamp(),
    withdrawn_case_version=c.version,withdrawal_reason=reason where id=d.id;
  return jsonb_build_object('decision_id',d.id,'status','withdrawn');
end;
$$;
revoke all on function internal.withdraw_decision(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.withdraw_decision(uuid,integer,text) to authenticated;
create function api.withdraw_decision(p_decision_id uuid,p_expected_version integer,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.withdraw_decision(p_decision_id,p_expected_version,p_reason);
$$;
revoke all on function api.withdraw_decision(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function api.withdraw_decision(uuid,integer,text) to authenticated;

create function internal.approve_decision(p_decision_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('decision:approve'); d private.decisions; c private.evidence_cases; case_id uuid; subject uuid;
begin
  select x.case_id,e.subject_id into case_id,subject from private.decisions x join private.evidence_cases e on e.id=x.case_id where x.id=p_decision_id;
  if not found then raise exception 'decision not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id=case_id for update;
  select * into d from private.decisions x where x.id = p_decision_id for update;
  if not found or d.status <> 'proposed' then raise exception 'decision not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('decision:approve');
  if actor in (d.proposed_by, c.subject_id) then
    raise exception 'a second, independent approver is required' using errcode = '42501';
  end if;
  if c.version is distinct from d.case_version or c.status <> 'open'
    or internal.evidence_case_snapshot(c.id) is distinct from d.reviewed_snapshot then
    raise exception 'case changed after proposal' using errcode = 'PT409';
  end if;
  update private.decisions set status = 'approved', approved_by = actor, approved_at = statement_timestamp()
  where id = d.id;
  update private.evidence_cases set status = 'decided', version = version + 1, claimed_by = null, claim_expires_at = null,claim_nonce=null
  where id = c.id;
  return jsonb_build_object('decision_id', d.id, 'status', 'approved');
end;
$$;
revoke all on function internal.approve_decision(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.approve_decision(uuid) to authenticated;
create function api.approve_decision(p_decision_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.approve_decision(p_decision_id);
$$;
revoke all on function api.approve_decision(uuid) from public, anon, authenticated, service_role;
grant execute on function api.approve_decision(uuid) to authenticated;

create function internal.place_legal_hold(p_subject_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('legal_hold:manage'); h private.legal_holds;
begin
  if p_subject_id = actor then raise exception 'cannot hold own account' using errcode = '42501'; end if;
  perform internal.lock_evidence_subject(p_subject_id);
  actor:=internal.staff_actor('legal_hold:manage');
  insert into private.legal_holds (subject_id, reason, placed_by) values (p_subject_id, p_reason, actor) returning * into h;
  return jsonb_build_object('hold_id', h.id);
end;
$$;
revoke all on function internal.place_legal_hold(uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.place_legal_hold(uuid, text) to authenticated;
create function api.place_legal_hold(p_subject_id uuid, p_reason text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.place_legal_hold(p_subject_id, p_reason);
$$;
revoke all on function api.place_legal_hold(uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.place_legal_hold(uuid, text) to authenticated;

-- Server: called by the account-deletion transaction. Idempotent; the clock
-- starts at the first call and every retained artifact gets the same deadline.
create function internal.close_account_evidence(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare closure private.account_closures; scheduled integer; trial_fingerprints integer;
begin
  perform internal.lock_evidence_subject(p_user_id);
  perform e.id from private.evidence_cases e where e.subject_id=p_user_id order by e.id for update;
  insert into private.account_closures (user_id, closed_at, evidence_delete_after)
  values (p_user_id, statement_timestamp(), statement_timestamp() + interval '90 days')
  on conflict (user_id) do nothing;
  select * into closure from private.account_closures x where x.user_id = p_user_id;
  update private.evidence_artifacts a set retain_until = closure.evidence_delete_after
  where a.owner_id = p_user_id and a.state in ('uploaded', 'clean', 'rejected')
    and a.retain_until is distinct from closure.evidence_delete_after;
  get diagnostics scheduled = row_count;
  -- DEC-27: detach the trial fingerprint and keep it 3 years after closure.
  update private.trial_identities set owner_id = null, entitlement_id = null,
    detached_at = closure.closed_at, retain_until = closure.closed_at + interval '3 years'
  where owner_id = p_user_id;
  get diagnostics trial_fingerprints = row_count;
  update private.evidence_cases set status = 'closed', claimed_by = null, claim_expires_at = null,claim_nonce=null,
    version=least(version::bigint+1,2147483647)::integer
  where subject_id = p_user_id and status = 'open' and kind in('kyc','business');
  return jsonb_build_object('closed_at', closure.closed_at,
    'evidence_delete_after', closure.evidence_delete_after, 'scheduled', scheduled,
    'trial_fingerprints_detached', trial_fingerprints);
end;
$$;
revoke all on function internal.close_account_evidence(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.close_account_evidence(uuid) to service_role;
create function api.close_account_evidence(p_user_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.close_account_evidence(p_user_id);
$$;
revoke all on function api.close_account_evidence(uuid) from public, anon, authenticated, service_role;
grant execute on function api.close_account_evidence(uuid) to service_role;

-- Banned identities (DEC-30). When an approved restrict_account decision bans
-- a verified person, the server records the keyed HMAC of their ID number (the
-- number itself is never stored) so a new account with the same ID is refused.
-- The fingerprint is kept 5 years from the ban, then purged; a later ban of the
-- same identity restarts the period. Only a reason category is kept, never an
-- accusation. ID documents still follow DEC-22 (90 days after account deletion).
create table private.banned_identities (
  identity_hmac text primary key check (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  decision_id uuid not null references private.decisions (id) on delete restrict,
  category text not null check (category in ('fraud', 'fake_listings', 'harassment', 'impersonation', 'repeat_abuse', 'other')),
  banned_at timestamptz not null default statement_timestamp(),
  retain_until timestamptz not null,
  check (retain_until = banned_at + interval '5 years')
);
create index banned_identities_expiry_idx on private.banned_identities (retain_until);
alter table private.banned_identities enable row level security;
revoke all on private.banned_identities from public, anon, authenticated, service_role;

-- Server only, after an approved restriction. Idempotent per identity.
create function internal.record_identity_ban(p_decision_id uuid, p_identity_hmac text, p_category text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare ban private.banned_identities; decision private.decisions; deadline timestamptz;
begin
  if p_identity_hmac is null or p_identity_hmac !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' then
    raise exception 'identity fingerprint required' using errcode='22023';
  end if;
  if p_category is null or p_category not in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other') then
    raise exception 'ban category required' using errcode='22023';
  end if;
  select d.* into decision from private.decisions d where d.id=p_decision_id and d.status='approved' and d.action='restrict_account';
  if not found then raise exception 'an approved account restriction is required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_identity_hmac,2701));
  select b.* into ban from private.banned_identities b where b.identity_hmac=p_identity_hmac for update;
  if found and ban.decision_id=p_decision_id then
    if ban.category is distinct from p_category then raise exception 'conflicting ban retry' using errcode='PT409'; end if;
    return jsonb_build_object('banned',ban.retain_until>clock_timestamp(),'retain_until',ban.retain_until);
  end if;
  if ban.identity_hmac is not null and decision.approved_at<ban.banned_at then
    raise exception 'restriction event is older than current ban' using errcode='PT409';
  end if;
  -- Retention starts at the approved restriction event, never its retry or a
  -- delayed callback. Replaying an already-expired event cannot resurrect it.
  deadline:=decision.approved_at+interval '5 years';
  if deadline<=clock_timestamp() then return jsonb_build_object('banned',false,'retain_until',deadline); end if;
  insert into private.banned_identities(identity_hmac,decision_id,category,banned_at,retain_until)
  values(p_identity_hmac,p_decision_id,p_category,decision.approved_at,deadline)
  on conflict(identity_hmac) do update set decision_id=excluded.decision_id,category=excluded.category,
    banned_at=excluded.banned_at,retain_until=excluded.retain_until returning * into ban;
  return jsonb_build_object('banned',true,'retain_until',ban.retain_until);
end;
$$;
revoke all on function internal.record_identity_ban(uuid, text, text) from public, anon, authenticated, service_role;
-- Raw core helper has no client/service EXECUTE; trusted derived commands call it as owner.
-- Raw API driver lives only in fixture-core-drivers.sql, excluded from target.

-- Server only, during ID verification: is this identity banned or has it used
-- its free trial? Returns facts only, never the decision or other accounts.
create function internal.identity_status(p_identity_hmac text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  if p_identity_hmac is null or p_identity_hmac !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' then
    raise exception 'identity fingerprint required' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'banned', exists (select 1 from private.banned_identities b where b.identity_hmac = p_identity_hmac and b.retain_until>clock_timestamp()),
    'trial_used', exists (select 1 from private.trial_identities t where t.identity_hmac = p_identity_hmac));
end;
$$;
revoke all on function internal.identity_status(text) from public, anon, authenticated, service_role;
grant execute on function internal.identity_status(text) to service_role;
create function api.identity_status(p_identity_hmac text)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.identity_status(p_identity_hmac);
$$;
revoke all on function api.identity_status(text) from public, anon, authenticated, service_role;
grant execute on function api.identity_status(text) to service_role;

-- Server-only sweep: purge bans whose 5-year period has ended.
create function internal.purge_expired_identity_bans(p_limit integer)
returns integer language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  with due as (
    select b.identity_hmac from private.banned_identities b
    where b.retain_until <= statement_timestamp()
    order by b.retain_until limit p_limit
    for update skip locked
  )
  delete from private.banned_identities b using due where b.identity_hmac = due.identity_hmac;
  get diagnostics n = row_count;
  with due as (select b.decision_id from private.identity_ban_bindings b where b.retain_until<=clock_timestamp() order by b.retain_until limit p_limit for update skip locked)
  delete from private.identity_ban_bindings b using due where b.decision_id=due.decision_id;
  return n;
end;
$$;
revoke all on function internal.purge_expired_identity_bans(integer) from public, anon, authenticated, service_role;
grant execute on function internal.purge_expired_identity_bans(integer) to service_role;
create function api.purge_expired_identity_bans(p_limit integer)
returns integer language sql security invoker set search_path = pg_catalog as $$
  select internal.purge_expired_identity_bans(p_limit);
$$;
revoke all on function api.purge_expired_identity_bans(integer) from public, anon, authenticated, service_role;
grant execute on function api.purge_expired_identity_bans(integer) to service_role;

-- Source: docs/backend-foundation/prototypes/publication.sql
-- BF-05 publication and media integrity candidate. A post goes
-- draft -> pending_moderation (owner submit, funded) -> live (staff approval,
-- which writes the search projection in the same commit) -> paused / sold /
-- archived / expired. Media are owned objects with an upload journal and a
-- per-account quota; posts link to them, so one object used as cover and in the
-- gallery counts once. Read-time rules hide anything not live, not visible or
-- past visible_until without waiting for a job.

-- Post content (nullable while drafting; required at submission per kind).
alter table private.posts
  add column title text check (title is null or length(title) between 1 and 120),
  add column description text check (description is null or length(description) <= 5000),
  add column province_id text references private.provinces (id),
  add column city_id text,
  add column locality_label text check (locality_label is null or length(locality_label) between 1 and 120),
  add column submitted_at timestamptz,
  add column published_at timestamptz,
  add column visible_until timestamptz,
  add column status_reason text check (status_reason is null or length(status_reason) <= 500);
alter table private.posts add constraint posts_city_province_fkey
  foreign key (city_id, province_id) references private.cities (id, province_id);
alter table private.posts add constraint posts_live_has_window
  check (status <> 'live' or (published_at is not null and visible_until is not null and visible_until > published_at));
create index posts_owner_submitted_idx on private.posts (owner_id, kind, submitted_at);

-- Live edits (source content_edit_requests): the owner edits a copy of a live
-- post with the normal draft commands while the approved version stays public.
-- Staff review the copy in the same queue; approval merges it into the live
-- post in one commit and deletes the copy. One open edit per post, two
-- approved edits per post (source MAX_APPROVED_CONTENT_EDITS). Queue claims and
-- reports are in moderation-queues.sql, applied after this file.
alter table private.posts add column edit_of uuid references private.posts (id) on delete cascade;
alter table private.posts add constraint posts_edit_copy_state
  check (edit_of is null or (edit_of <> id and status in ('draft', 'pending_moderation', 'rejected')));
create unique index posts_one_open_edit_idx on private.posts (edit_of) where edit_of is not null;

-- When the status last changed: the lifecycle sweep's clock (DEC-28/29).
alter table private.posts add column status_changed_at timestamptz not null default statement_timestamp();
create index posts_lifecycle_idx on private.posts (status, status_changed_at);
create function internal.post_status_clock()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.status is distinct from old.status then new.status_changed_at := statement_timestamp(); end if;
  return new;
end;
$$;
revoke all on function internal.post_status_clock() from public, anon, authenticated, service_role;
create trigger post_status_clock before update of status on private.posts
  for each row execute function internal.post_status_clock();

-- An edit copy keeps its live post's identity and category. While a copy
-- exists, the live post's content, details and media are frozen (lifecycle
-- columns may still change), so the copy is the single place being edited.
create function internal.post_edit_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare target uuid;
begin
  if tg_table_name = 'posts' then
    if tg_op = 'INSERT' then
      if new.edit_of is not null and not exists (select 1 from private.posts o where o.id = new.edit_of
          and o.edit_of is null and (o.owner_id, o.kind, o.area, o.category_key)
            = (new.owner_id, new.kind, new.area, new.category_key)) then
        raise exception 'an edit must match its live post' using errcode = '23514';
      end if;
      return new;
    end if;
    if new.edit_of is distinct from old.edit_of
      or (new.edit_of is not null and new.category_key is distinct from old.category_key) then
      raise exception 'an edit stays linked to its live post and category' using errcode = '23514';
    end if;
    if (new.category_key, new.activity_key, new.title, new.description, new.province_id, new.city_id, new.locality_label)
        is distinct from (old.category_key, old.activity_key, old.title, old.description, old.province_id, old.city_id, old.locality_label)
      and exists (select 1 from private.posts e where e.edit_of = new.id) then
      raise exception 'this post has an edit waiting for review' using errcode = '23514';
    end if;
    return new;
  end if;
  foreach target in array case tg_op when 'INSERT' then array[new.post_id] when 'DELETE' then array[old.post_id]
      else array[old.post_id, new.post_id] end loop
    -- A cascade from a deleted post is not an edit.
    if exists (select 1 from private.posts e where e.edit_of = target)
      and exists (select 1 from private.posts p where p.id = target) then
      raise exception 'this post has an edit waiting for review' using errcode = '23514';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;
revoke all on function internal.post_edit_guard() from public, anon, authenticated, service_role;
create trigger post_edit_link before insert or update on private.posts
  for each row execute function internal.post_edit_guard();
create trigger post_edit_listing_frozen before insert or update or delete on private.listing_details
  for each row execute function internal.post_edit_guard();
create trigger post_edit_business_frozen before insert or update or delete on private.business_details
  for each row execute function internal.post_edit_guard();
create trigger post_edit_event_frozen before insert or update or delete on private.event_details
  for each row execute function internal.post_edit_guard();

-- An edit copy never holds funding; it is reviewed against the live post's.
create function internal.post_activation_edit_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if exists (select 1 from private.posts p where p.id = new.post_id and p.edit_of is not null) then
    raise exception 'an edit uses its live post''s funding' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.post_activation_edit_guard() from public, anon, authenticated, service_role;
create trigger post_activation_not_edit before insert or update on private.post_activations
  for each row execute function internal.post_activation_edit_guard();

create table private.media_objects (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  kind text not null check (kind in ('image', 'video')),
  object_key text not null unique,
  declared_bytes integer not null check (declared_bytes > 0),
  size_bytes integer check (size_bytes > 0),
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  mime text,
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  state text not null default 'intent' check (state in ('intent', 'ready', 'rejected', 'cleanup_required', 'deleted')),
  created_at timestamptz not null default statement_timestamp(),
  state_changed_at timestamptz not null default statement_timestamp(),
  cleanup_token uuid,
  cleanup_lease_until timestamptz,
  cleanup_attempt integer not null default 0 check (cleanup_attempt >= 0),
  -- Last time a post stopped using this object. Cleanup waits 24 hours after
  -- it, so a deleted or expired post's photos can be reused in a new post.
  unlinked_at timestamptz,
  deleted_at timestamptz,
  -- Current site ceilings: images 5 MB, videos 50 MB.
  check ((kind = 'image' and declared_bytes <= 5242880) or (kind = 'video' and declared_bytes <= 52428800)),
  check (state <> 'ready' or (sha256 is not null and size_bytes is not null and size_bytes <= declared_bytes and mime is not null)),
  check ((state = 'deleted') = (deleted_at is not null))
);
create index media_objects_owner_idx on private.media_objects (owner_id) where state in ('intent', 'ready');

create function internal.media_object_transition_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if (new.id, new.owner_id, new.kind, new.object_key, new.declared_bytes) is distinct from
     (old.id, old.owner_id, old.kind, old.object_key, old.declared_bytes) then
    raise exception 'media identity is immutable' using errcode = '23514';
  end if;
  if new.state <> old.state and not (
      (old.state = 'intent' and new.state in ('ready', 'rejected', 'cleanup_required'))
      or (old.state in ('ready', 'rejected') and new.state = 'cleanup_required')
      or (old.state = 'cleanup_required' and new.state = 'deleted')) then
    raise exception 'invalid media transition % -> %', old.state, new.state using errcode = '23514';
  end if;
  if old.sha256 is not null and new.sha256 is distinct from old.sha256 then
    raise exception 'media digest is immutable' using errcode = '23514';
  end if;
  new.state_changed_at := case when new.state <> old.state then statement_timestamp() else old.state_changed_at end;
  return new;
end;
$$;
revoke all on function internal.media_object_transition_guard() from public, anon, authenticated, service_role;
create trigger media_object_transition before update on private.media_objects
  for each row execute function internal.media_object_transition_guard();

create table private.post_media (
  post_id uuid not null references private.posts (id) on delete cascade,
  object_id uuid not null references private.media_objects (id) on delete restrict,
  purpose text not null check (purpose in ('cover', 'gallery', 'logo', 'video')),
  position smallint not null check (position between 0 and 49),
  focal_x numeric(4, 3) check (focal_x between 0 and 1),
  focal_y numeric(4, 3) check (focal_y between 0 and 1),
  primary key (post_id, purpose, position),
  unique (post_id, purpose, object_id)
);
create unique index post_media_one_cover_idx on private.post_media (post_id) where purpose = 'cover';
create unique index post_media_one_logo_idx on private.post_media (post_id) where purpose = 'logo';
create index post_media_object_idx on private.post_media (object_id);
create trigger post_edit_media_frozen before insert or update or delete on private.post_media
  for each row execute function internal.post_edit_guard();

-- Record when an object stops being used by a post (edit, delete, expiry sweep).
create function internal.media_unlink_clock()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  update private.media_objects set unlinked_at = statement_timestamp() where id = old.object_id;
  return null;
end;
$$;
revoke all on function internal.media_unlink_clock() from public, anon, authenticated, service_role;
create trigger post_media_unlink_clock after delete or update of object_id on private.post_media
  for each row execute function internal.media_unlink_clock();

-- Append-only moderation history. post_id is a plain reference so deleting a
-- post (account deletion) never rewrites history. For a live edit, post_id is
-- the live post and edit_id the reviewed copy (also a plain reference).
create table private.moderation_log (
  id bigint generated always as identity primary key,
  post_id uuid not null,
  edit_id uuid,
  staff_id uuid not null references auth.users (id) on delete restrict,
  decision text not null check (decision in ('approve', 'reject')),
  post_revision integer not null,
  reason text,
  decided_at timestamptz not null default statement_timestamp(),
  price_only boolean not null default false,
  check (edit_id is distinct from post_id),
  check (not price_only or edit_id is not null)
);
create index moderation_log_approved_edits_idx on private.moderation_log (post_id)
  where edit_id is not null and decision = 'approve';
create trigger moderation_log_append_only before update or delete on private.moderation_log
  for each row execute function internal.append_only_guard();
create trigger moderation_log_no_truncate before truncate on private.moderation_log
  for each statement execute function internal.append_only_guard();

alter table private.media_objects enable row level security;
alter table private.post_media enable row level security;
alter table private.moderation_log enable row level security;
revoke all on private.media_objects, private.post_media, private.moderation_log
  from public, anon, authenticated, service_role;

insert into private.staff_capabilities (role, capability, requires_recent_mfa) values
  ('moderator', 'post:moderate', true),
  ('governor', 'post:moderate', true);

-- Owner: reserve an upload. The object key is random (it never reveals the
-- owner, because public post pages show it) and generated here; the server route
-- streams the bytes to exactly this key and then calls finalize_media.
create function internal.begin_media_upload(p_kind text, p_bytes integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); used bigint; obj private.media_objects;
begin
  if p_kind is null or p_kind not in ('image', 'video') or p_bytes is null or p_bytes < 1
    or (p_kind = 'image' and p_bytes > 5242880) or (p_kind = 'video' and p_bytes > 52428800) then
    raise exception 'images up to 5 MB, videos up to 50 MB' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 808));
  if (select count(*) from private.media_objects m where m.owner_id = actor and m.state = 'intent') >= 20 then
    raise exception 'too many unfinished uploads' using errcode = 'PT429';
  end if;
  select coalesce(sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes)), 0) into used
  from private.media_objects m where m.owner_id = actor and m.state <> 'deleted';
  if used + p_bytes > internal.media_storage_allowance(actor) then
    raise exception 'storage for your package is full; delete unused posts or drafts' using errcode = 'PT409';
  end if;
  insert into private.media_objects (owner_id, kind, object_key, declared_bytes)
  values (actor, p_kind, 'media/' || pg_catalog.gen_random_uuid(), p_bytes)
  returning * into obj;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('object_id', obj.id, 'object_key', obj.object_key, 'max_bytes', obj.declared_bytes);
end;
$$;
revoke all on function internal.begin_media_upload(text, integer) from public, anon, authenticated, service_role;
grant execute on function internal.begin_media_upload(text, integer) to authenticated;
create function api.begin_media_upload(p_kind text, p_bytes integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.begin_media_upload(p_kind, p_bytes);
$$;
revoke all on function api.begin_media_upload(text, integer) from public, anon, authenticated, service_role;
grant execute on function api.begin_media_upload(text, integer) to authenticated;

-- Server: record what was actually stored. Anything outside the declared size
-- or allowed types becomes rejected (and is later cleaned up), never ready.
create function internal.finalize_media(p_object_id uuid, p_size integer, p_sha256 text, p_mime text,
  p_width integer, p_height integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare obj private.media_objects; ok boolean;
begin
  select * into obj from private.media_objects m where m.id = p_object_id for update;
  if not found or obj.state <> 'intent' then raise exception 'upload not pending' using errcode = '22023'; end if;
  ok := p_size between 1 and obj.declared_bytes and p_sha256 ~ '^[a-f0-9]{64}$'
    and ((obj.kind = 'image' and p_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
          and p_width between 1 and 20000 and p_height between 1 and 20000)
      or (obj.kind = 'video' and p_mime in ('video/mp4', 'video/webm')));
  if ok then
    update private.media_objects set state = 'ready', size_bytes = p_size, sha256 = p_sha256, mime = p_mime,
      width = p_width, height = p_height where id = obj.id;
  else
    update private.media_objects set state = 'rejected',
      size_bytes = case when p_size > 0 then p_size else null end where id = obj.id;
  end if;
  return jsonb_build_object('object_id', obj.id, 'state', case when ok then 'ready' else 'rejected' end);
end;
$$;
revoke all on function internal.finalize_media(uuid, integer, text, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function internal.finalize_media(uuid, integer, text, text, integer, integer) to service_role;
create function api.finalize_media(p_object_id uuid, p_size integer, p_sha256 text, p_mime text,
  p_width integer default null, p_height integer default null)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.finalize_media(p_object_id, p_size, p_sha256, p_mime, p_width, p_height);
$$;
revoke all on function api.finalize_media(uuid, integer, text, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function api.finalize_media(uuid, integer, text, text, integer, integer) to service_role;

create function internal.assert_post_revision(p_revision integer)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if p_revision is null or p_revision not between 1 and 2147483646 then
    raise exception 'positive expected revision required' using errcode='22023';
  end if;
end;
$$;
revoke all on function internal.assert_post_revision(integer) from public,anon,authenticated,service_role;

-- Owner: edit draft content. Revision-fenced like every other draft command.
create function internal.save_post_content(p_post_id uuid, p_expected_revision integer, p_content jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts; c jsonb := p_content; rev integer;
  city text; locality text; title_value text; description_value text;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  if jsonb_typeof(c) is distinct from 'object' or octet_length(c::text) > 12000
    or not (array(select jsonb_object_keys(c)) <@ array['title', 'description', 'province_id', 'city_id', 'locality_label'])
    or exists (select 1 from jsonb_each(c) e where jsonb_typeof(e.value) not in ('string', 'null')) then
    raise exception 'invalid content' using errcode = '22023';
  end if;
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'only drafts can be edited' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if (c ? 'city_id' and c->>'city_id' is not null) and (c ? 'locality_label' and c->>'locality_label' is not null) then
    raise exception 'choose a listed city or type a locality, not both' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_each(c) e where e.key in ('title','description') and
    e.value #>> '{}' ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]') then
    raise exception 'remove hidden formatting characters' using errcode='22023';
  end if;
  if c->>'title' is not null then
    title_value := nullif(internal.validate_attribute_value(jsonb_build_object('type','string',
      'maxLength',case when post.kind='event' then 120 else 100 end),c->'title') #>> '{}','');
  end if;
  if c->>'description' is not null then
    description_value := nullif(internal.validate_attribute_value(jsonb_build_object('type','string',
      'maxLength',case when post.kind='business' then 3000 else 5000 end),c->'description') #>> '{}','');
  end if;
  if c->>'locality_label' is not null then
    locality := nullif(internal.validate_attribute_value('{"type":"string","maxLength":80}'::jsonb,
      c->'locality_label') #>> '{}','');
  end if;
  city := case when c ? 'city_id' then c->>'city_id'
    when locality is not null then null else post.city_id end;
  locality := case when c ? 'locality_label' then locality
    when c->>'city_id' is not null then null else post.locality_label end;
  if (city is not null and locality is not null) or (locality is not null and
    (length(locality)>80 or locality ~ U&'[\0001-\001F\007F-\009F\200B-\200F\202A-\202E\2060-\206F]')) then
    raise exception 'invalid public locality' using errcode='22023';
  end if;
  update private.posts set
    title = case when c ? 'title' then title_value else title end,
    description = case when c ? 'description' then description_value else description end,
    province_id = case when c ? 'province_id' then c->>'province_id' else province_id end,
    city_id = city,
    locality_label = locality,
    revision = revision + 1, content_updated_at = statement_timestamp()
  where id = post.id returning revision into rev;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'revision', rev);
end;
$$;
revoke all on function internal.save_post_content(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.save_post_content(uuid, integer, jsonb) to authenticated;
create function api.save_post_content(p_post_id uuid, p_expected_revision integer, p_content jsonb)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.save_post_content(p_post_id, p_expected_revision, p_content);
$$;
revoke all on function api.save_post_content(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function api.save_post_content(uuid, integer, jsonb) to authenticated;

-- Owner: replace a draft's media links in one step.
create function internal.set_post_media(p_post_id uuid, p_expected_revision integer, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  photo_limit integer;
  video_limit integer;
  rev integer;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 62 then
    raise exception 'invalid media list' using errcode = '22023';
  end if;
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'only drafts can be edited' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if post.kind='event' then
    photo_limit:=10; video_limit:=1; -- Free event product allowance, not paid funding.
  else
    select e.max_photos,e.max_videos into photo_limit,video_limit
    from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
    where a.post_id=post.id and a.owner_id=actor and a.released_at is null
      and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
      and (e.area is null or e.area=post.area)
      and (e.owner_id=actor or exists(select 1 from private.entitlement_members m where m.entitlement_id=e.id and m.member_id=actor))
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'));
    if not found then
      -- Unfunded drafts can prepare the current public product allowance.
      -- Submission still checks the exact entitlement selected atomically.
      select max(v.max_photos),max(v.max_videos) into photo_limit,video_limit
      from private.plan_versions v where v.is_public and v.retired_at is null and (v.area is null or v.area=post.area);
    end if;
  end if;
  if photo_limit is null or video_limit is null then
    raise exception 'no current media allowance available' using errcode='PT409';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i
      where jsonb_typeof(i) <> 'object'
        or not (array(select jsonb_object_keys(i)) <@ array['object_id', 'purpose', 'position', 'focal_x', 'focal_y'])
        or i->>'purpose' not in ('cover', 'gallery', 'logo', 'video')
        or (i->>'object_id') !~ '^[0-9a-f-]{36}$' or (i->>'position') !~ '^[0-9]{1,2}$') then
    raise exception 'invalid media item' using errcode = '22023';
  end if;
  -- Lock before checking state; cleanup takes the same lock and rechecks links.
  perform m.id from private.media_objects m
    where m.owner_id=actor and m.id in (select (i->>'object_id')::uuid from jsonb_array_elements(p_items) i)
    order by m.id for update;
  -- Every object must be the owner's, finished, and the right kind for its purpose.
  if exists (select 1 from jsonb_array_elements(p_items) i
      left join private.media_objects m on m.id = (i->>'object_id')::uuid
      where m.id is null or m.owner_id <> actor or m.state <> 'ready'
        or (i->>'purpose' = 'video') <> (m.kind = 'video')) then
    raise exception 'media must be your own finished uploads of the right type' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items) i where i->>'purpose' = 'cover') > 1
    or (select count(*) from jsonb_array_elements(p_items) i where i->>'purpose' = 'logo') > 1 then
    raise exception 'one cover and one logo at most' using errcode = '22023';
  end if;
  -- Per-post limits count distinct objects, so reuse costs nothing extra.
  if (select count(distinct i->>'object_id') from jsonb_array_elements(p_items) i where i->>'purpose' <> 'video') > photo_limit
    or (select count(distinct i->>'object_id') from jsonb_array_elements(p_items) i where i->>'purpose' = 'video') > video_limit then
    raise exception 'media exceed the current post allowance' using errcode = '22023';
  end if;
  delete from private.post_media where post_id = post.id;
  begin
    insert into private.post_media (post_id, object_id, purpose, position, focal_x, focal_y)
    select post.id, (i->>'object_id')::uuid, i->>'purpose', (i->>'position')::smallint,
      (i->>'focal_x')::numeric, (i->>'focal_y')::numeric
    from jsonb_array_elements(p_items) i;
  exception when unique_violation or check_violation then
    raise exception 'duplicate media position or invalid focal point' using errcode = '22023';
  end;
  update private.posts set revision = revision + 1, content_updated_at = statement_timestamp()
  where id = post.id returning revision into rev;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'revision', rev);
end;
$$;
revoke all on function internal.set_post_media(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.set_post_media(uuid, integer, jsonb) to authenticated;
create function api.set_post_media(p_post_id uuid, p_expected_revision integer, p_items jsonb)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.set_post_media(p_post_id, p_expected_revision, p_items);
$$;
revoke all on function api.set_post_media(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function api.set_post_media(uuid, integer, jsonb) to authenticated;

-- Owner: submit for moderation. Content and media rules per kind match the
-- current site; funding is reserved now (paid activation, or event fair use).
create function internal.submit_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  photos integer;
  videos integer;
  photo_limit integer;
  video_limit integer;
  rev integer;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'this post cannot be submitted now' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if post.title is null then
    raise exception 'title length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 2 else 5 end,
    'maxLength',case when post.kind='event' then 120 else 100 end),to_jsonb(post.title));
  if post.kind in ('listing','event') and post.description is null then
    raise exception 'description length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 0 else 20 end,
    'maxLength',case when post.kind='business' then 3000 else 5000 end),to_jsonb(coalesce(post.description,'')));
  if post.province_id is null or (post.city_id is null and post.locality_label is null) then
    raise exception 'province and city or locality required' using errcode = '22023';
  end if;
  if post.kind='listing' then
    if not exists(select 1 from private.listing_details d where d.post_id=post.id and d.price_mode is not null) then
      raise exception 'choose an explicit listing price' using errcode='22023';
    end if;
    perform internal.validate_listing_attributes(post.category_key,d.attributes,true)
      from private.listing_details d where d.post_id=post.id;
  end if;
  select count(distinct pm.object_id) into photos from private.post_media pm
    where pm.post_id = post.id and pm.purpose in ('cover', 'gallery');
  select count(distinct pm.object_id) into videos from private.post_media pm where pm.post_id=post.id and pm.purpose='video';
  if ((post.kind='listing' and post.category_key<>'jobs_services') or (post.kind='business' and post.area='tourism_events')) and photos = 0 then
    raise exception 'at least one photo is required' using errcode = '22023';
  end if;
  if post.kind='event' and photos+videos=0 then raise exception 'at least one photo or video required' using errcode='22023'; end if;
  if photos > 0 and not exists (select 1 from private.post_media pm where pm.post_id = post.id and pm.purpose = 'cover') then
    raise exception 'choose a cover photo' using errcode = '22023';
  end if;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = post.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = '22023';
  end if;
  if post.edit_of is not null then
    -- A live edit uses the live post's funding: no new activation or fair use.
    if not exists (select 1 from private.posts o where o.id = post.edit_of and o.status = 'live') then
      raise exception 'the live post is no longer published' using errcode = 'PT409';
    end if;
    if internal.edit_is_price_only(post.edit_of, post.id) then
      if internal.recent_price_change(post.edit_of) then
        raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
      end if;
    elsif internal.approved_edit_count(post.edit_of) >= internal.edit_allowance(post.edit_of) then
      raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
    end if;
    select f.max_photos, f.max_videos into photo_limit, video_limit
      from internal.post_funding(post.edit_of) f where f.funded_until > statement_timestamp();
    if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode = '22023';
    end if;
  elsif post.kind = 'event' then
    -- Free events: fair use of 5 active (pending or live) and 10 submissions per 30 days.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 909));
    if (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.status in ('pending_moderation', 'live') and p.id <> post.id) >= 5
      or (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.submitted_at > statement_timestamp() - interval '30 days' and p.id <> post.id) >= 10 then
      raise exception 'event fair-use limit reached' using errcode = 'PT429';
    end if;
  else
    perform internal.activate_post(post.id);
    select e.max_photos,e.max_videos into photo_limit,video_limit
      from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
      where a.post_id=post.id and a.released_at is null;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode='22023';
    end if;
  end if;
  update private.posts set status = 'pending_moderation', submitted_at = statement_timestamp(),
    status_reason = null, revision = revision + 1
  where id = post.id returning revision into rev;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'pending_moderation', 'revision', rev);
end;
$$;
revoke all on function internal.submit_post(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function internal.submit_post(uuid, integer) to authenticated;
create function api.submit_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.submit_post(p_post_id, p_expected_revision);
$$;
revoke all on function api.submit_post(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function api.submit_post(uuid, integer) to authenticated;

-- Current funding of a post: an event's own window (free product allowance of
-- 10 photos and 1 video), or the live activation's usable entitlement. The same
-- predicate as public eligibility; a post with no row has no funding.
create function internal.post_funding(p_post_id uuid)
returns table (funded_until timestamptz, max_photos integer, max_videos integer)
language sql stable security invoker set search_path = pg_catalog as $$
  select e.ends_at, 10, 1
  from private.posts p join private.event_details e on e.post_id = p.id
  where p.id = p_post_id and p.kind = 'event'
  union all
  select e.ends_at, e.max_photos, e.max_videos
  from private.posts p
  join private.post_activations a on a.post_id = p.id and a.released_at is null and a.owner_id = p.owner_id
  join private.entitlements e on e.id = a.entitlement_id
  where p.id = p_post_id and p.kind <> 'event'
    and internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
    and (e.area is null or e.area = p.area)
    and (e.owner_id = p.owner_id or exists (select 1 from private.entitlement_members m
      where m.entitlement_id = e.id and m.member_id = p.owner_id))
    and exists (select 1 from private.current_account_access u where u.id = e.owner_id)
    and (e.source <> 'retail_paid' or exists (select 1 from private.payments pay
      where pay.id = e.payment_id and pay.owner_id = e.owner_id and pay.status = 'complete'));
$$;
revoke all on function internal.post_funding(uuid) from public, anon, authenticated, service_role;

-- Approved edits that count against the allowance; price-only edits are free.
create function internal.approved_edit_count(p_post_id uuid)
returns integer language sql stable security invoker set search_path = pg_catalog as $$
  select count(*)::integer from private.moderation_log l
  where l.post_id = p_post_id and l.edit_id is not null and l.decision = 'approve' and not l.price_only;
$$;
revoke all on function internal.approved_edit_count(uuid) from public, anon, authenticated, service_role;

-- Edit allowance follows the package (DEC-29): 2 approved edits per started 30
-- days of the funding package (30 days 2, 90 days 6, 180 days 12), at least 2.
-- Free events and unfunded posts get 2.
create function internal.edit_allowance(p_post_id uuid)
returns integer language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce((
    select greatest(2, 2 * ceil(extract(epoch from (e.ends_at - e.starts_at)) / 2592000.0))::integer
    from private.posts p
    join private.post_activations a on a.post_id = p.id and a.released_at is null
    join private.entitlements e on e.id = a.entitlement_id
    where p.id = p_post_id and p.kind <> 'event'
    order by e.ends_at desc limit 1), 2);
$$;
revoke all on function internal.edit_allowance(uuid) from public, anon, authenticated, service_role;

-- True when an edit copy changes only the listing price terms: same content
-- columns, same details apart from price, same media links, and a different price.
create function internal.edit_is_price_only(p_original_id uuid, p_edit_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce((
    select o.kind = 'listing'
      and (o.category_key, o.activity_key, o.title, o.description, o.province_id, o.city_id, o.locality_label)
        is not distinct from (e.category_key, e.activity_key, e.title, e.description, e.province_id, e.city_id, e.locality_label)
      and (to_jsonb(od) - array['post_id', 'price_mode', 'price_cents', 'price_negotiable'])
        = (to_jsonb(ed) - array['post_id', 'price_mode', 'price_cents', 'price_negotiable'])
      and (od.price_mode, od.price_cents, od.price_negotiable) is distinct from (ed.price_mode, ed.price_cents, ed.price_negotiable)
      and coalesce((select jsonb_agg(to_jsonb(pm) - 'post_id' order by pm.purpose, pm.position)
             from private.post_media pm where pm.post_id = o.id), '[]')
        = coalesce((select jsonb_agg(to_jsonb(pm) - 'post_id' order by pm.purpose, pm.position)
             from private.post_media pm where pm.post_id = e.id), '[]')
    from private.posts o
    join private.posts e on e.id = p_edit_id and e.edit_of = o.id
    join private.listing_details od on od.post_id = o.id
    join private.listing_details ed on ed.post_id = e.id
    where o.id = p_original_id), false);
$$;
revoke all on function internal.edit_is_price_only(uuid, uuid) from public, anon, authenticated, service_role;

-- Price-only edits are free but limited to one approved change per 24 hours,
-- so staff are not asked to review a new price every few minutes.
create function internal.recent_price_change(p_post_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select exists (select 1 from private.moderation_log l
    where l.post_id = p_post_id and l.price_only and l.decision = 'approve'
      and l.decided_at > statement_timestamp() - interval '24 hours');
$$;
revoke all on function internal.recent_price_change(uuid) from public, anon, authenticated, service_role;

-- Package-based limits (DEC-29) share one capacity: posts the owner's current
-- packages allow at once, and the largest per-post media allowance (10 photos
-- of 5 MB and 1 video of 50 MB by default).
create function internal.package_capacity(p_owner uuid, out posts integer, out post_media_bytes bigint)
language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce(sum(e.slot_capacity), 0)::integer,
    greatest(104857600, coalesce(max(e.max_photos::bigint * 5242880 + e.max_videos::bigint * 52428800), 0))
  from private.entitlements e
  where internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
    and (e.owner_id = p_owner or exists (select 1 from private.entitlement_members m
      where m.entitlement_id = e.id and m.member_id = p_owner))
    and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
    and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
      where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'));
$$;
revoke all on function internal.package_capacity(uuid) from public, anon, authenticated, service_role;

-- Drafts: 5 plus 1 per post in the owner's packages.
create function internal.draft_allowance(p_owner uuid)
returns integer language sql stable security invoker set search_path = pg_catalog as $$
  select 5 + c.posts from internal.package_capacity(p_owner) c;
$$;
revoke all on function internal.draft_allowance(uuid) from public, anon, authenticated, service_role;

-- Storage follows the package, never a fixed account quota: room for every
-- post the owner can hold at full media size (live posts, drafts and up to 5
-- free events), i.e. (2 x package posts + 10) x the per-post media allowance.
create function internal.media_storage_allowance(p_owner uuid)
returns bigint language sql stable security invoker set search_path = pg_catalog as $$
  select (2 * c.posts + 10)::bigint * c.post_media_bytes from internal.package_capacity(p_owner) c;
$$;
revoke all on function internal.media_storage_allowance(uuid) from public, anon, authenticated, service_role;

-- The search projection is derived from the post row: visible only while live.
-- New approvals and approved edits both write it here, in their own commit.
create function internal.write_post_projection(p_post_id uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare post private.posts; price record; public_facets jsonb := '{}'::jsonb;
begin
  select * into post from private.posts p where p.id = p_post_id;
  select d.price_mode, d.price_cents into price from private.listing_details d where d.post_id = post.id;
  if post.kind = 'listing' then
    select coalesce(jsonb_object_agg(f.key, d.attributes->f.key), '{}'::jsonb) into public_facets
    from private.category_fields f join private.listing_details d on d.post_id = post.id
    where f.category_key = post.category_key and f.facet_kind is not null and d.attributes ? f.key;
  end if;
  insert into private.post_search_documents (post_id, kind, area, category_key, activity_key, province_id, city_id,
    locality_label, title, summary, price_mode, price_cents, published_at, visible_until, is_visible, facets)
  values (post.id, post.kind, post.area, post.category_key, post.activity_key, post.province_id, post.city_id,
    coalesce(post.locality_label, (select c.label from private.cities c where c.id = post.city_id)),
    post.title, left(coalesce(post.description, ''), 300), price.price_mode,
    case when price.price_mode = 'on_request' then null else price.price_cents end,
    post.published_at, post.visible_until, post.status = 'live', public_facets)
  on conflict (post_id) do update set kind = excluded.kind, area = excluded.area,
    category_key = excluded.category_key, activity_key = excluded.activity_key, province_id = excluded.province_id,
    city_id = excluded.city_id, locality_label = excluded.locality_label, title = excluded.title,
    summary = excluded.summary, price_mode = excluded.price_mode, price_cents = excluded.price_cents,
    published_at = excluded.published_at, visible_until = excluded.visible_until, is_visible = excluded.is_visible,
    facets = excluded.facets;
end;
$$;
revoke all on function internal.write_post_projection(uuid) from public, anon, authenticated, service_role;

-- Merge an approved edit copy into its live post (caller holds both row locks,
-- live post first). Content, details and media links are replaced in this
-- commit; publication time and funding window are unchanged.
create function internal.apply_post_edit(p_original_id uuid, p_edit_id uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare original private.posts; edit private.posts; photo_limit integer; video_limit integer;
  detail jsonb; links jsonb; rev integer; price_only boolean;
begin
  select * into original from private.posts p where p.id = p_original_id;
  select * into edit from private.posts p where p.id = p_edit_id and p.edit_of = p_original_id;
  if original.status not in ('live', 'paused') then
    raise exception 'the live post is no longer published' using errcode = 'PT409';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode = 'PT409';
  end if;
  price_only := internal.edit_is_price_only(original.id, edit.id);
  if price_only and internal.recent_price_change(original.id) then
    raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
  end if;
  if not price_only and internal.approved_edit_count(original.id) >= internal.edit_allowance(original.id) then
    raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
  end if;
  select f.max_photos, f.max_videos into photo_limit, video_limit
    from internal.post_funding(original.id) f where f.funded_until > statement_timestamp();
  if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
  -- Lock linked objects before reading their state, as linking and cleanup do.
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = edit.id) order by m.id for update;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = edit.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = 'PT409';
  end if;
  if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose <> 'video') > photo_limit
    or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose = 'video') > video_limit then
    raise exception 'funded media allowance changed since submission' using errcode = 'PT409';
  end if;
  select coalesce(jsonb_agg(to_jsonb(pm)), '[]') into links from private.post_media pm where pm.post_id = edit.id;
  detail := case original.kind
      when 'listing' then (select to_jsonb(d) from private.listing_details d where d.post_id = edit.id)
      when 'business' then (select to_jsonb(d) from private.business_details d where d.post_id = edit.id)
      else (select to_jsonb(d) from private.event_details d where d.post_id = edit.id) end
    || jsonb_build_object('post_id', original.id);
  delete from private.posts where id = edit.id; -- with its details, links and queue claim
  update private.posts set category_key = edit.category_key, activity_key = edit.activity_key, title = edit.title,
    description = edit.description, province_id = edit.province_id, city_id = edit.city_id,
    locality_label = edit.locality_label, revision = revision + 1, content_updated_at = statement_timestamp()
  where id = original.id returning revision into rev;
  if original.kind = 'listing' then
    delete from private.listing_details where post_id = original.id;
    insert into private.listing_details select (jsonb_populate_record(null::private.listing_details, detail)).*;
  elsif original.kind = 'business' then
    delete from private.business_details where post_id = original.id;
    insert into private.business_details select (jsonb_populate_record(null::private.business_details, detail)).*;
  else
    delete from private.event_details where post_id = original.id;
    insert into private.event_details select (jsonb_populate_record(null::private.event_details, detail)).*;
  end if;
  delete from private.post_media where post_id = original.id;
  insert into private.post_media
  select (jsonb_populate_record(null::private.post_media, l || jsonb_build_object('post_id', original.id))).*
  from jsonb_array_elements(links) l;
  perform internal.write_post_projection(original.id);
  return jsonb_build_object('revision', rev, 'price_only', price_only);
end;
$$;
revoke all on function internal.apply_post_edit(uuid, uuid) from public, anon, authenticated, service_role;

-- Staff: approve or reject the exact revision that was reviewed, holding the
-- current queue claim for it (moderation-queues.sql). Approval publishes (or,
-- for an edit, merges) and writes the search projection in the same commit.
create function internal.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_reason text,
  p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.staff_actor('post:moderate');
  post private.posts;
  original_id uuid;
  funded_until timestamptz;
  photo_limit integer;
  video_limit integer;
  rev integer;
  merged jsonb;
begin
  perform internal.assert_post_revision(p_expected_revision);
  if p_decision is null or p_decision not in ('approve', 'reject')
    or (p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) not between 5 and 500) then
    raise exception 'decision and, for rejections, a reason are required' using errcode = '22023';
  end if;
  -- An edit locks its live post before the copy, like every owner command.
  select p.edit_of into original_id from private.posts p where p.id = p_post_id;
  if original_id is not null then
    perform 1 from private.posts p where p.id = original_id for update;
  end if;
  select * into post from private.posts p where p.id = p_post_id for update;
  if not found or post.status <> 'pending_moderation' or post.edit_of is distinct from original_id then
    raise exception 'post is not awaiting moderation' using errcode = '22023';
  end if;
  actor := internal.staff_actor('post:moderate'); -- authority after any lock wait
  if post.owner_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  perform internal.consume_queue_claim('post', post.id, actor, p_claim_generation, p_claim_nonce);
  if post.revision <> p_expected_revision then raise exception 'post changed since review' using errcode = 'PT409'; end if;
  if p_decision = 'reject' then
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'moderation'
      where post_id = post.id and released_at is null;
    update private.posts set status = 'rejected', status_reason = btrim(p_reason), revision = revision + 1
      where id = post.id;
  elsif original_id is not null then
    merged := internal.apply_post_edit(original_id, post.id);
    rev := (merged->>'revision')::integer;
  else
    if not exists(select 1 from private.current_account_access u where u.id=post.owner_id) then
      raise exception 'post owner is no longer eligible' using errcode='PT409';
    end if;
    select f.funded_until, f.max_photos, f.max_videos into funded_until, photo_limit, video_limit
      from internal.post_funding(post.id) f;
    if funded_until is null or funded_until <= statement_timestamp() then
      raise exception 'funding or event window has ended' using errcode = 'PT409';
    end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose='video')>video_limit then
      raise exception 'funded media allowance changed since submission' using errcode='PT409';
    end if;
    update private.posts set status = 'live', published_at = statement_timestamp(), visible_until = funded_until,
      revision = revision + 1 where id = post.id;
    perform internal.write_post_projection(post.id);
  end if;
  perform internal.staff_actor('post:moderate'); -- authority after claim-row and media waits
  insert into private.moderation_log (post_id, edit_id, staff_id, decision, post_revision, reason, price_only)
  values (coalesce(original_id, post.id), case when original_id is not null then post.id end, actor, p_decision,
    p_expected_revision, nullif(btrim(coalesce(p_reason, '')), ''), coalesce((merged->>'price_only')::boolean, false));
  if original_id is not null then
    return jsonb_build_object('id', post.id, 'edit_of', original_id,
      'status', case when p_decision = 'approve' then 'merged' else 'rejected' end, 'post_revision', rev,
      'price_only', coalesce((merged->>'price_only')::boolean, false));
  end if;
  return jsonb_build_object('id', post.id, 'status', case when p_decision = 'approve' then 'live' else 'rejected' end,
    'visible_until', funded_until);
end;
$$;
revoke all on function internal.moderate_post(uuid, integer, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.moderate_post(uuid, integer, text, text, text, uuid) to authenticated;
create function api.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text,
  p_claim_generation text, p_claim_nonce uuid, p_reason text default null)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.moderate_post(p_post_id, p_expected_revision, p_decision, p_reason, p_claim_generation, p_claim_nonce);
$$;
revoke all on function api.moderate_post(uuid, integer, text, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.moderate_post(uuid, integer, text, text, uuid, text) to authenticated;

-- Owner: take a live post down (pause), mark it sold (listings) or archive it.
-- The post leaves search immediately and frees its paid slot.
create function internal.set_post_state(p_post_id uuid, p_expected_revision integer, p_action text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts; next_status text; rev integer;
begin
  perform internal.assert_post_revision(p_expected_revision);
  next_status := case p_action when 'pause' then 'paused' when 'sold' then 'sold' when 'archive' then 'archived' end;
  if next_status is null then raise exception 'unknown action' using errcode = '22023'; end if;
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('live', 'paused') or (p_action = 'sold' and post.kind <> 'listing')
    or (p_action = 'pause' and post.status <> 'live') then
    raise exception 'action not available for this post' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if next_status in ('sold', 'archived') then
    delete from private.posts where edit_of = post.id; -- an edit of a finished post is moot
  end if;
  update private.posts set status = next_status, revision = revision + 1 where id = post.id returning revision into rev;
  update private.post_search_documents set is_visible = false where post_id = post.id;
  update private.post_activations set released_at = statement_timestamp(),
    release_reason = case when p_action = 'sold' then 'sold' else 'owner' end
  where post_id = post.id and released_at is null;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', next_status, 'revision', rev);
end;
$$;
revoke all on function internal.set_post_state(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function internal.set_post_state(uuid, integer, text) to authenticated;
create function api.set_post_state(p_post_id uuid, p_expected_revision integer, p_action text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.set_post_state(p_post_id, p_expected_revision, p_action);
$$;
revoke all on function api.set_post_state(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function api.set_post_state(uuid, integer, text) to authenticated;

-- Owner: start an edit of a live post. The copy holds the same content,
-- details and media links and is then changed with the normal draft commands
-- and submit_post. Posts columns are copied explicitly (identity and content);
-- lifecycle columns start fresh. Detail and link rows are copied whole.
create function internal.create_post_edit(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); original private.posts; edit_id uuid := pg_catalog.gen_random_uuid();
begin
  perform internal.assert_post_revision(p_expected_revision);
  select * into original from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found or original.edit_of is not null then raise exception 'post not found' using errcode = '22023'; end if;
  if original.status <> 'live' then
    raise exception 'only live posts are edited through review' using errcode = '22023';
  end if;
  if original.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if exists (select 1 from private.posts e where e.edit_of = original.id) then
    raise exception 'this post already has an edit waiting' using errcode = 'PT409';
  end if;
  insert into private.posts (id, owner_id, kind, area, category_key, activity_key, title, description,
    province_id, city_id, locality_label, edit_of)
  values (edit_id, original.owner_id, original.kind, original.area, original.category_key, original.activity_key,
    original.title, original.description, original.province_id, original.city_id, original.locality_label, original.id);
  if original.kind = 'listing' then
    insert into private.listing_details select (jsonb_populate_record(null::private.listing_details,
      to_jsonb(d) || jsonb_build_object('post_id', edit_id))).* from private.listing_details d where d.post_id = original.id;
  elsif original.kind = 'business' then
    insert into private.business_details select (jsonb_populate_record(null::private.business_details,
      to_jsonb(d) || jsonb_build_object('post_id', edit_id))).* from private.business_details d where d.post_id = original.id;
  else
    insert into private.event_details select (jsonb_populate_record(null::private.event_details,
      to_jsonb(d) || jsonb_build_object('post_id', edit_id))).* from private.event_details d where d.post_id = original.id;
  end if;
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = original.id) order by m.id for update;
  insert into private.post_media select (jsonb_populate_record(null::private.post_media,
    to_jsonb(pm) || jsonb_build_object('post_id', edit_id))).* from private.post_media pm where pm.post_id = original.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', edit_id, 'edit_of', original.id, 'status', 'draft', 'revision', 1,
    'edits_remaining', greatest(0, internal.edit_allowance(original.id) - internal.approved_edit_count(original.id)),
    'price_change_always_allowed', true);
end;
$$;
revoke all on function internal.create_post_edit(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function internal.create_post_edit(uuid, integer) to authenticated;
create function api.create_post_edit(p_post_id uuid, p_expected_revision integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.create_post_edit(p_post_id, p_expected_revision);
$$;
revoke all on function api.create_post_edit(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function api.create_post_edit(uuid, integer) to authenticated;

-- Owner: discard an edit (draft, waiting or rejected). The live post is unchanged.
create function internal.discard_post_edit(p_edit_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); original_id uuid; edit private.posts;
begin
  perform internal.assert_post_revision(p_expected_revision);
  select p.edit_of into original_id from private.posts p where p.id = p_edit_id and p.owner_id = actor;
  if original_id is null then raise exception 'edit not found' using errcode = '22023'; end if;
  perform 1 from private.posts p where p.id = original_id for update;
  select * into edit from private.posts p where p.id = p_edit_id and p.owner_id = actor and p.edit_of = original_id for update;
  if not found then raise exception 'edit not found' using errcode = '22023'; end if;
  if edit.revision <> p_expected_revision then raise exception 'edit changed' using errcode = 'PT409'; end if;
  delete from private.posts where id = edit.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', edit.id, 'edit_of', original_id, 'status', 'discarded');
end;
$$;
revoke all on function internal.discard_post_edit(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function internal.discard_post_edit(uuid, integer) to authenticated;
create function api.discard_post_edit(p_edit_id uuid, p_expected_revision integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.discard_post_edit(p_edit_id, p_expected_revision);
$$;
revoke all on function api.discard_post_edit(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function api.discard_post_edit(uuid, integer) to authenticated;

-- Owner: delete a post (DEC-28). Its slot is freed at once; the activation
-- history is kept, so the package's re-post allowance is not reset. Its photos
-- and videos stay reusable for 24 hours. Not while an account legal hold is active.
create function internal.delete_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts;
begin
  perform internal.assert_post_revision(p_expected_revision);
  -- Match hold placement/closure ordering: account subject before post rows.
  perform internal.lock_evidence_subject(actor);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found or post.edit_of is not null then raise exception 'post not found' using errcode = '22023'; end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if exists (select 1 from private.legal_holds h where h.subject_id = actor and h.released_at is null) then
    raise exception 'posts cannot be deleted during a legal hold' using errcode = 'PT409';
  end if;
  delete from private.posts where id = post.id; -- with its edit copy, links and queue claim
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'deleted');
end;
$$;
revoke all on function internal.delete_post(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function internal.delete_post(uuid, integer) to authenticated;
create function api.delete_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.delete_post(p_post_id, p_expected_revision);
$$;
revoke all on function api.delete_post(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function api.delete_post(uuid, integer) to authenticated;

-- Server job (DEC-28/29), run hourly. Nothing is kept indefinitely:
--  * live posts past visible_until become expired and release their slot;
--  * owners get a notice at expiry and 7 and 21 days later (renew offers), and
--    a warning 45 days into an untouched draft, rejected or paused post;
--  * expired, sold and archived posts are deleted 30 days after that status,
--    untouched drafts, rejected and paused posts (and edit copies) after 60
--    days; their photos and videos follow 24 hours later via the media sweep.
-- Posts awaiting review are never touched; owners under a legal hold are skipped.
create function internal.run_post_lifecycle(p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare n_expired integer := 0; n_notices integer := 0; n_deleted integer := 0;
  r record; post private.posts; changed integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  -- Candidates are unlocked. Take the shared hold/closure subject guard before
  -- locking a post, then re-evaluate all mutable eligibility under those locks.
  for r in
    select p.id,p.owner_id from private.posts p
    where p.status='live' and p.visible_until<=clock_timestamp()
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
    order by p.visible_until,p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.status='live'
      and p.visible_until<=clock_timestamp() for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null) then continue; end if;
    update private.posts set status='expired',status_reason='Visibility period ended',revision=revision+1 where id=post.id;
    update private.post_search_documents set is_visible=false where post_id=post.id;
    update private.post_activations set released_at=clock_timestamp(),release_reason='expired'
      where post_id=post.id and released_at is null;
    n_expired:=n_expired+1;
  end loop;
  -- At most p_limit new notices per invocation; old dedupe rows do not starve
  -- later notices. Lock/recheck each post so a concurrent renewal invalidates
  -- the captured revision before its stale reminder can be queued.
  for r in
    select n.* from (
      select 'post_expired'::text as kind,p.id,p.owner_id,p.revision,p.status_changed_at as due_at,
        'post_expired:'||p.id||':'||floor(extract(epoch from p.status_changed_at))::bigint as dedupe_key
      from private.posts p where p.status='expired'
      union all
      select 'post_expiry_reminder',p.id,p.owner_id,p.revision,p.status_changed_at+make_interval(days=>d.day),
        'post_expiry_reminder:'||p.id||':'||d.day||':'||floor(extract(epoch from p.status_changed_at))::bigint
      from private.posts p cross join (values(7),(21)) d(day)
      where p.status='expired' and p.status_changed_at<=clock_timestamp()-make_interval(days=>d.day)
      union all
      select 'draft_deletion_warning',p.id,p.owner_id,p.revision,greatest(p.content_updated_at,p.status_changed_at)+interval '45 days',
        'draft_deletion_warning:'||p.id||':'||floor(extract(epoch from greatest(p.content_updated_at,p.status_changed_at)))::bigint
      from private.posts p where p.status in('draft','rejected','paused')
        and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '45 days'
    ) n where not exists(select 1 from private.outbox_events o where o.dedupe_key=n.dedupe_key)
      and not exists(select 1 from private.legal_holds h where h.subject_id=n.owner_id and h.released_at is null)
    order by n.due_at,n.id,n.kind,n.dedupe_key limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.revision=r.revision for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values(r.kind,r.id,r.owner_id,r.dedupe_key)
      on conflict(dedupe_key) do nothing;
    get diagnostics changed=row_count; n_notices:=n_notices+changed;
  end loop;
  for r in
    select p.id,p.owner_id from private.posts p
    where ((p.status in('expired','sold','archived') and p.status_changed_at<=clock_timestamp()-interval '30 days')
      or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '60 days'))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.posts e where e.edit_of=p.id and (e.status='pending_moderation' or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days'))
    order by p.status_changed_at,p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and
      ((p.status in('expired','sold','archived') and p.status_changed_at<=clock_timestamp()-interval '30 days')
       or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '60 days'))
      for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.posts e where e.edit_of=post.id and (e.status='pending_moderation' or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days')) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('post_deleted',post.id,post.owner_id,'post_deleted:'||post.id) on conflict(dedupe_key) do nothing;
    delete from private.posts where id=post.id;
    n_deleted:=n_deleted+1;
  end loop;
  return jsonb_build_object('expired',n_expired,'notices',n_notices,'deleted',n_deleted);
end;
$$;
revoke all on function internal.run_post_lifecycle(integer) from public, anon, authenticated, service_role;
grant execute on function internal.run_post_lifecycle(integer) to service_role;
create function api.run_post_lifecycle(p_limit integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.run_post_lifecycle(p_limit);
$$;
revoke all on function api.run_post_lifecycle(integer) from public, anon, authenticated, service_role;
grant execute on function api.run_post_lifecycle(integer) to service_role;

-- One current eligibility relation for public browse and detail. Projection
-- flags alone cannot extend funding or survive account/membership revocation.
-- This private invoker view has no browser/service table grants.
create view private.public_eligible_posts with (security_invoker=true) as
  select p.id
  from private.posts p join private.current_account_access u on u.id=p.owner_id
  where p.status='live' and p.published_at<=statement_timestamp() and p.visible_until>statement_timestamp()
    and ((p.kind='event' and exists(select 1 from private.event_details e where e.post_id=p.id and e.ends_at>statement_timestamp()))
      or (p.kind<>'event' and exists(
        select 1 from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
        join private.current_account_access funding_owner on funding_owner.id=e.owner_id
        where a.post_id=p.id and a.owner_id=p.owner_id and a.released_at is null
          and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
          and (e.area is null or e.area=p.area)
          and (e.owner_id=p.owner_id or exists(select 1 from private.entitlement_members m
            where m.entitlement_id=e.id and m.member_id=p.owner_id))
          and (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=p.id and pm.purpose<>'video')<=e.max_photos
          and (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=p.id and pm.purpose='video')<=e.max_videos
          and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
            where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete')))));
revoke all on private.public_eligible_posts from public,anon,authenticated,service_role;

-- Public detail: current eligibility, visible projection and both time windows.
create function internal.get_public_post(p_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'area', p.area, 'category', p.category_key,
    'activity', p.activity_key, 'title', p.title, 'description', p.description, 'province', p.province_id,
    'city', p.city_id, 'locality', d.locality_label, 'price_mode', d.price_mode, 'price_cents', d.price_cents::text,
    'published_at', p.published_at, 'visible_until', p.visible_until,
    'condition', case when p.kind='listing' then d.facets->>'condition' end,
    'media', coalesce((select jsonb_agg(jsonb_build_object('purpose', pm.purpose, 'position', pm.position,
        'object_key', m.object_key, 'kind', m.kind, 'width', m.width, 'height', m.height,
        'focal_x', pm.focal_x, 'focal_y', pm.focal_y) order by pm.purpose, pm.position)
      from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = p.id and m.state = 'ready'), '[]'))
  from private.posts p join private.post_search_documents d on d.post_id = p.id
  where p.id = p_id and d.is_visible and (d.visible_until is null or d.visible_until>statement_timestamp())
    and exists(select 1 from private.public_eligible_posts eligible where eligible.id=p.id);
$$;
revoke all on function internal.get_public_post(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.get_public_post(uuid) to anon, authenticated;
create function api.get_public_post(p_id uuid)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.get_public_post(p_id);
$$;
revoke all on function api.get_public_post(uuid) from public, anon, authenticated, service_role;
grant execute on function api.get_public_post(uuid) to anon, authenticated;

-- Server sweep: abandoned intents (> 1 hour), rejected uploads and finished
-- uploads that no post has used for 24 hours become cleanup_required.
-- An object is in use while any row in any table with a foreign key to
-- media_objects points at it (post media today; avatars, logos and report
-- attachments later), so a new consumer is protected without changing cleanup.
-- Consumers must reference objects through a single-column foreign key and lock
-- the object row before linking; anything else fails closed (treated as in use).
create function internal.media_object_in_use(p_object_id uuid)
returns boolean language plpgsql stable security invoker set search_path = pg_catalog as $$
declare fk record; used boolean;
begin
  for fk in
    select c.conrelid::regclass::text as rel, c.conkey, n.nspname as schema_name, r.relname as table_name
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where c.contype = 'f' and c.confrelid = 'private.media_objects'::regclass
  loop
    if cardinality(fk.conkey) <> 1 then return true; end if;
    execute format('select exists (select 1 from %I.%I where %I = $1)', fk.schema_name, fk.table_name,
      (select a.attname from pg_catalog.pg_attribute a
        where a.attrelid = fk.rel::regclass and a.attnum = fk.conkey[1]))
      into used using p_object_id;
    if used then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function internal.media_object_in_use(uuid) from public, anon, authenticated, service_role;

create function internal.claim_media_cleanup(p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare rows jsonb := '[]'::jsonb; obj private.media_objects; token uuid;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'limit 1 to 500' using errcode = '22023'; end if;
  for obj in
    select m.* from private.media_objects m
    where (m.state = 'intent' and m.created_at < statement_timestamp() - interval '1 hour')
       or m.state = 'rejected'
       or (m.state = 'ready' and coalesce(greatest(m.created_at, m.unlinked_at), m.created_at)
             < statement_timestamp() - interval '24 hours'
           and not internal.media_object_in_use(m.id))
       or (m.state = 'cleanup_required' and coalesce(m.cleanup_lease_until,'-infinity'::timestamptz) <= statement_timestamp())
    order by m.created_at limit p_limit
    for update skip locked
  loop
    -- A separate statement sees links committed before this object lock was acquired.
    if internal.media_object_in_use(obj.id) then continue; end if;
    token := pg_catalog.gen_random_uuid();
    update private.media_objects set state='cleanup_required',cleanup_token=token,
      cleanup_lease_until=statement_timestamp()+interval '5 minutes',cleanup_attempt=cleanup_attempt+1
      where id=obj.id;
    rows := rows || jsonb_build_array(jsonb_build_object('object_id',obj.id,'object_key',obj.object_key,
      'claim_token',token,'lease_until',statement_timestamp()+interval '5 minutes'));
  end loop;
  return rows;
end;
$$;
revoke all on function internal.claim_media_cleanup(integer) from public, anon, authenticated, service_role;
grant execute on function internal.claim_media_cleanup(integer) to service_role;
create function api.claim_media_cleanup(p_limit integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.claim_media_cleanup(p_limit);
$$;
revoke all on function api.claim_media_cleanup(integer) from public, anon, authenticated, service_role;
grant execute on function api.claim_media_cleanup(integer) to service_role;

-- Server: record deletion only after the object store confirms it.
create function internal.mark_media_deleted(p_object_id uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_claim_token is null then raise exception 'cleanup claim token required' using errcode='22023'; end if;
  if exists(select 1 from private.media_objects where id=p_object_id and state='deleted' and cleanup_token=p_claim_token) then return true; end if;
  update private.media_objects set state = 'deleted', deleted_at = statement_timestamp()
  where id = p_object_id and state = 'cleanup_required' and cleanup_token=p_claim_token
    and cleanup_lease_until>statement_timestamp();
  if not found then raise exception 'object is not awaiting deletion' using errcode = '22023'; end if;
  return true;
end;
$$;
revoke all on function internal.mark_media_deleted(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.mark_media_deleted(uuid,uuid) to service_role;
create function api.mark_media_deleted(p_object_id uuid,p_claim_token uuid)
returns boolean language sql security invoker set search_path = pg_catalog as $$
  select internal.mark_media_deleted(p_object_id,p_claim_token);
$$;
revoke all on function api.mark_media_deleted(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function api.mark_media_deleted(uuid,uuid) to service_role;

-- Replaces the BF-07 reversal so a refund or chargeback also takes the funded
-- posts off the site in the same commit.
create or replace function internal.reverse_payment(p_payment_id uuid, p_kind text, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare pay private.payments; released integer := 0; v_post_ids uuid[]; payment_owner uuid;
begin
  if p_kind not in ('refunded', 'chargeback') or length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'reversal kind and audit reason required' using errcode = '22023';
  end if;
  select p.owner_id into payment_owner from private.payments p where p.id=p_payment_id;
  if payment_owner is not null then perform internal.lock_evidence_subject(payment_owner); end if;
  select * into pay from private.payments p where p.id = p_payment_id for update;
  if not found or pay.status <> 'complete' then
    raise exception 'only completed payments can be reversed' using errcode = '22023';
  end if;
  begin
    perform e.id from private.entitlements e where e.payment_id=pay.id order by e.id for update nowait;
    perform p.id from private.posts p where p.id=pay.target_post_id or p.id in
      (select a.post_id from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
        where e.payment_id=pay.id and a.released_at is null)
      order by p.id for update of p nowait;
  exception when lock_not_available then
    raise exception 'funded posts are busy; retry reversal' using errcode='PT409';
  end;
  update private.payments set status = p_kind, fulfillment_status='reversed', status_changed_at = statement_timestamp() where id = pay.id;
  update private.entitlements set status = 'revoked', revoked_reason = 'payment_' || p_kind where payment_id = pay.id;
  with released_rows as (
    update private.post_activations a set released_at = statement_timestamp(), release_reason = 'payment_reversed'
    from private.entitlements e where e.id = a.entitlement_id and e.payment_id = pay.id and a.released_at is null
    returning a.post_id
  )
  select coalesce(array_agg(post_id), '{}') into v_post_ids from released_rows;
  released := cardinality(v_post_ids);
  update private.posts set status = 'expired', status_reason = 'Payment ' || p_kind, revision = revision + 1
    where id = any (v_post_ids) and status in ('live', 'pending_moderation');
  update private.post_search_documents set is_visible = false where post_id = any (v_post_ids);
  update private.post_addon_windows set revoked_at = statement_timestamp() where payment_id = pay.id and revoked_at is null;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_reversed:' || pay.id);
  return jsonb_build_object('status', p_kind, 'released_activations', released);
end;
$$;

-- Source: docs/backend-foundation/prototypes/moderation-queues.sql
-- BF-08 generic staff queues. Source queue_claims covered reports, KYC steps,
-- listings, businesses, promotions, content edits and business verification.
-- In the candidate, KYC and business verification are evidence cases with
-- their own reviewed claim columns (evidence-claim-contract.md). Every other
-- source subject is a post awaiting review (new posts of every kind and live
-- edits, see publication.sql) or a user report, and uses the claim below.
--
-- A claim is a lease on one typed subject. Each acquisition rotates a random
-- nonce and increments a monotonic generation; every decision, renewal,
-- release and claim-scoped read requires the exact live tuple held by the
-- current staff actor. Leases last 15 minutes with at most 4 renewals, and one
-- person holds at most 20 (source values). Concurrent claimers receive
-- disjoint items. Nobody claims or decides an item about themselves.
-- Governors and admins can free or reassign a claim, with a reason, audited.
-- Lock order: holder guard (advisory 1201 for the person who will hold the
-- claim), live post, edit copy, report, claim row. Staff authority is
-- re-derived after the last wait of every command, so a role or session lost
-- while waiting rolls the whole command back.

insert into private.staff_capabilities (role, capability, requires_recent_mfa) values
  ('moderator', 'queue:claim', false),
  ('governor', 'queue:claim', false),
  ('governor', 'queue:reassign', true),
  ('admin', 'queue:reassign', true),
  ('moderator', 'report:resolve', true),
  ('governor', 'report:resolve', true);

-- Reports about a public post. post_id becomes null if the post is deleted;
-- the subject account (owner at report time) is kept for repeat-abuse review.
create table private.reports (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  post_id uuid references private.posts (id) on delete set null,
  subject_account_id uuid not null references auth.users (id) on delete restrict,
  category text not null
    check (category in ('scam', 'prohibited_item', 'impersonation', 'harassment', 'misleading_info')),
  severity text not null default 'standard' check (severity in ('high', 'standard')),
  description text not null check (length(description) between 10 and 2000),
  reporter_id uuid references auth.users (id) on delete set null,
  reporter_ip_hmac text not null check (reporter_ip_hmac ~ '^[A-Za-z0-9_-]{43}$'),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_note text check (resolution_note is null or length(resolution_note) between 5 and 500),
  resolved_by uuid references auth.users (id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check ((status = 'open') = (resolved_at is null)),
  check ((resolved_at is null) = (resolved_by is null)),
  check ((resolved_at is null) = (resolution_note is null))
);
create index reports_open_idx on private.reports (severity, created_at) where status = 'open';
create index reports_subject_idx on private.reports (subject_account_id, status);
create unique index reports_one_open_signed_in_idx on private.reports (post_id, reporter_id)
  where status = 'open' and reporter_id is not null;
create unique index reports_one_open_anonymous_idx on private.reports (post_id, reporter_ip_hmac)
  where status = 'open' and reporter_id is null;

-- One claim row per subject, kept after release so the generation never repeats.
create table private.queue_claims (
  id bigint generated always as identity primary key,
  post_id uuid unique references private.posts (id) on delete cascade,
  report_id uuid unique references private.reports (id) on delete cascade,
  claimed_by uuid references auth.users (id) on delete restrict,
  claim_generation bigint not null default 0 check (claim_generation >= 0),
  claim_nonce uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  renewals smallint not null default 0 check (renewals between 0 and 4),
  check (num_nonnulls(post_id, report_id) = 1),
  check ((claimed_by is null and claim_nonce is null and claimed_at is null and claim_expires_at is null and renewals = 0)
    or (claimed_by is not null and claim_nonce is not null and claimed_at is not null and claim_expires_at is not null
      and claim_expires_at > claimed_at and claim_generation > 0))
);
create index queue_claims_holder_idx on private.queue_claims (claimed_by, claim_expires_at) where claimed_by is not null;

-- Staff release and reassignment history. Subject ids are plain references so
-- deleting a post or report never rewrites it.
create table private.queue_claim_events (
  id bigint generated always as identity primary key,
  post_id uuid,
  report_id uuid,
  actor_id uuid not null references auth.users (id) on delete restrict,
  event text not null check (event in ('released_by_staff', 'reassigned')),
  from_staff uuid not null references auth.users (id) on delete restrict,
  to_staff uuid references auth.users (id) on delete restrict,
  claim_generation bigint not null check (claim_generation > 0),
  reason text not null check (length(reason) between 5 and 500),
  created_at timestamptz not null default statement_timestamp(),
  check (num_nonnulls(post_id, report_id) = 1),
  check ((event = 'reassigned') = (to_staff is not null))
);
create trigger queue_claim_events_append_only before update or delete on private.queue_claim_events
  for each row execute function internal.append_only_guard();
create trigger queue_claim_events_no_truncate before truncate on private.queue_claim_events
  for each statement execute function internal.append_only_guard();

alter table private.reports enable row level security;
alter table private.queue_claims enable row level security;
alter table private.queue_claim_events enable row level security;
revoke all on private.reports, private.queue_claims, private.queue_claim_events
  from public, anon, authenticated, service_role;

-- Losing staff access frees the person's claims at once.
create function internal.release_queue_claims_on_revocation()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.revoked_at is not null or not exists (select 1 from private.staff_capabilities c
      where c.role = new.role and c.capability = 'queue:claim') then
    update private.queue_claims set claimed_by = null, claim_nonce = null, claimed_at = null,
      claim_expires_at = null, renewals = 0
    where claimed_by = new.user_id;
  end if;
  return null;
end;
$$;
revoke all on function internal.release_queue_claims_on_revocation() from public, anon, authenticated, service_role;
create trigger staff_roles_release_queue_claims after update of revoked_at, role on private.staff_roles
  for each row execute function internal.release_queue_claims_on_revocation();

-- Nobody works an item about themselves: their own post or edit, a report they
-- filed, or a report about them.
create function internal.queue_conflict(p_actor uuid, p_post_id uuid, p_report_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select case when p_post_id is not null
    then exists (select 1 from private.posts p where p.id = p_post_id and p.owner_id = p_actor)
    else exists (select 1 from private.reports r where r.id = p_report_id
      and (r.reporter_id = p_actor or r.subject_account_id = p_actor))
  end;
$$;
revoke all on function internal.queue_conflict(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Lock an open subject in the shared order and return its typed reference.
create function internal.lock_queue_subject(p_subject text, p_id uuid, out post_id uuid, out report_id uuid)
language plpgsql security invoker set search_path = pg_catalog as $$
declare original_id uuid;
begin
  if p_subject = 'post' then
    select p.edit_of into original_id from private.posts p where p.id = p_id;
    if original_id is not null then
      perform 1 from private.posts p where p.id = original_id for update;
    end if;
    select p.id into post_id from private.posts p
      where p.id = p_id and p.status = 'pending_moderation' and p.edit_of is not distinct from original_id for update;
    if post_id is null then raise exception 'item is not awaiting review' using errcode = '22023'; end if;
  elsif p_subject = 'report' then
    select r.id into report_id from private.reports r where r.id = p_id and r.status = 'open' for update;
    if report_id is null then raise exception 'item is not awaiting review' using errcode = '22023'; end if;
  else
    raise exception 'unknown queue item' using errcode = '22023';
  end if;
end;
$$;
revoke all on function internal.lock_queue_subject(text, uuid) from public, anon, authenticated, service_role;

create function internal.lock_queue_claim(p_post_id uuid, p_report_id uuid)
returns private.queue_claims language plpgsql security invoker set search_path = pg_catalog as $$
declare c private.queue_claims;
begin
  select q.* into c from private.queue_claims q
    where (q.post_id = p_post_id or q.report_id = p_report_id) for update;
  return c;
end;
$$;
revoke all on function internal.lock_queue_claim(uuid, uuid) from public, anon, authenticated, service_role;

-- Take (or, for the current holder, rotate) the claim on a locked subject.
-- Returns null when another reviewer holds a live claim.
create function internal.take_queue_claim(p_actor uuid, p_post_id uuid, p_report_id uuid)
returns private.queue_claims language plpgsql security invoker set search_path = pg_catalog as $$
declare c private.queue_claims;
begin
  if p_post_id is not null then
    insert into private.queue_claims (post_id) values (p_post_id) on conflict (post_id) do nothing;
  else
    insert into private.queue_claims (report_id) values (p_report_id) on conflict (report_id) do nothing;
  end if;
  c := internal.lock_queue_claim(p_post_id, p_report_id);
  if c.claimed_by is not null and c.claim_expires_at > clock_timestamp() then
    if c.claimed_by <> p_actor then return null; end if;
    -- The holder may rotate the tuple; the lease and renewals stay as they are.
    update private.queue_claims set claim_generation = claim_generation + 1, claim_nonce = pg_catalog.gen_random_uuid()
    where id = c.id and claim_generation < 9223372036854775807 returning * into c;
  else
    update private.queue_claims set claimed_by = p_actor, claim_generation = claim_generation + 1,
      claim_nonce = pg_catalog.gen_random_uuid(), claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp() + interval '15 minutes', renewals = 0
    where id = c.id and claim_generation < 9223372036854775807 returning * into c;
  end if;
  if c.id is null then raise exception 'claim generation exhausted' using errcode = 'PT409'; end if;
  return c;
end;
$$;
revoke all on function internal.take_queue_claim(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- The holder's view of a claim. Generations are canonical text (bigint precision).
create function internal.queue_claim_view(p_claim private.queue_claims)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select jsonb_build_object('subject', case when p_claim.post_id is not null then 'post' else 'report' end,
    'id', coalesce(p_claim.post_id, p_claim.report_id),
    'claim_generation', p_claim.claim_generation::text, 'claim_nonce', p_claim.claim_nonce,
    'claim_expires_at', p_claim.claim_expires_at, 'renewals_left', 4 - p_claim.renewals,
    'revision', (select p.revision from private.posts p where p.id = p_claim.post_id),
    'edit_of', (select p.edit_of from private.posts p where p.id = p_claim.post_id));
$$;
revoke all on function internal.queue_claim_view(private.queue_claims) from public, anon, authenticated, service_role;

create function internal.assert_queue_claim(p_claim private.queue_claims, p_actor uuid, p_generation text, p_nonce uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if p_generation is null or p_generation !~ '^[1-9][0-9]{0,18}$' or p_nonce is null then
    raise exception 'current claim generation and nonce required' using errcode = '22023';
  end if;
  if p_claim.id is null or p_claim.claimed_by is distinct from p_actor
    or p_claim.claim_generation::text is distinct from p_generation or p_claim.claim_nonce is distinct from p_nonce
    or p_claim.claim_expires_at is null or p_claim.claim_expires_at <= clock_timestamp() then
    raise exception 'current live queue claim required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function internal.assert_queue_claim(private.queue_claims, uuid, text, uuid) from public, anon, authenticated, service_role;

-- Decisions: the caller holds the subject lock. The claim is cleared in the
-- decision's own transaction, so a failed decision keeps it.
create function internal.consume_queue_claim(p_subject text, p_id uuid, p_actor uuid, p_generation text, p_nonce uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare c private.queue_claims;
begin
  c := internal.lock_queue_claim(case when p_subject = 'post' then p_id end, case when p_subject = 'report' then p_id end);
  perform internal.assert_queue_claim(c, p_actor, p_generation, p_nonce);
  update private.queue_claims set claimed_by = null, claim_nonce = null, claimed_at = null,
    claim_expires_at = null, renewals = 0
  where id = c.id;
end;
$$;
revoke all on function internal.consume_queue_claim(text, uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

-- Staff: claim the next items of a queue ('content' = posts and edits awaiting
-- review, oldest first; 'reports' = open reports, high severity first).
create function internal.claim_queue_items(p_queue text, p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:claim'); allowed integer; r record;
  c private.queue_claims; items jsonb := '[]'::jsonb;
begin
  if p_queue is null or p_queue not in ('content', 'reports') then
    raise exception 'unknown queue' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'claim between 1 and 25 items' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 1201));
  actor := internal.staff_actor('queue:claim'); -- authority after the holder guard wait
  allowed := least(p_limit, 20 - (select count(*) from private.queue_claims q
    where q.claimed_by = actor and q.claim_expires_at > clock_timestamp())::integer);
  if allowed <= 0 then return items; end if;
  -- Scan with headroom: a row another claimer committed after this scan began
  -- is skipped by take_queue_claim, and the next row takes its place.
  if p_queue = 'content' then
    for r in
      select p.id from private.posts p
      where p.status = 'pending_moderation' and p.owner_id <> actor
        and not exists (select 1 from private.queue_claims q where q.post_id = p.id
          and q.claimed_by is not null and q.claim_expires_at > clock_timestamp())
      order by p.submitted_at, p.id limit allowed * 2
      for update of p skip locked
    loop
      c := internal.take_queue_claim(actor, r.id, null);
      if c.id is not null then items := items || jsonb_build_array(internal.queue_claim_view(c)); end if;
      exit when jsonb_array_length(items) >= allowed;
    end loop;
  else
    for r in
      select x.id from private.reports x
      where x.status = 'open' and x.reporter_id is distinct from actor and x.subject_account_id <> actor
        and not exists (select 1 from private.queue_claims q where q.report_id = x.id
          and q.claimed_by is not null and q.claim_expires_at > clock_timestamp())
      order by (x.severity = 'high') desc, x.created_at, x.id limit allowed * 2
      for update of x skip locked
    loop
      c := internal.take_queue_claim(actor, null, r.id);
      if c.id is not null then items := items || jsonb_build_array(internal.queue_claim_view(c)); end if;
      exit when jsonb_array_length(items) >= allowed;
    end loop;
  end if;
  perform internal.staff_actor('queue:claim'); -- authority after any claim-row wait
  return items;
end;
$$;
revoke all on function internal.claim_queue_items(text, integer) from public, anon, authenticated, service_role;
grant execute on function internal.claim_queue_items(text, integer) to authenticated;
create function api.claim_queue_items(p_queue text, p_limit integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.claim_queue_items(p_queue, p_limit);
$$;
revoke all on function api.claim_queue_items(text, integer) from public, anon, authenticated, service_role;
grant execute on function api.claim_queue_items(text, integer) to authenticated;

-- Staff: claim one item opened from a queue list.
create function internal.claim_queue_item(p_subject text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:claim'); s record; c private.queue_claims;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 1201));
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  actor := internal.staff_actor('queue:claim'); -- authority after any lock wait
  if internal.queue_conflict(actor, s.post_id, s.report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  if (select count(*) from private.queue_claims q where q.claimed_by = actor and q.claim_expires_at > clock_timestamp()
      and not (q.post_id is not distinct from s.post_id and q.report_id is not distinct from s.report_id)) >= 20 then
    raise exception 'claim limit of 20 items reached' using errcode = 'PT429';
  end if;
  c := internal.take_queue_claim(actor, s.post_id, s.report_id);
  if c.id is null then raise exception 'item claimed by another reviewer' using errcode = 'PT409'; end if;
  perform internal.staff_actor('queue:claim'); -- authority after the claim-row wait
  return internal.queue_claim_view(c);
end;
$$;
revoke all on function internal.claim_queue_item(text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.claim_queue_item(text, uuid) to authenticated;
create function api.claim_queue_item(p_subject text, p_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.claim_queue_item(p_subject, p_id);
$$;
revoke all on function api.claim_queue_item(text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.claim_queue_item(text, uuid) to authenticated;

-- Holder: extend a live claim by 15 minutes, at most 4 times.
create function internal.renew_queue_claim(p_subject text, p_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:claim'); s record; c private.queue_claims;
begin
  -- Renewals can turn an apparently expired committed claim into a live one.
  -- Serialize that capacity change with acquisition and reassignment, before
  -- taking subject/claim row locks, including when renewal later rolls back.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,1201));
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  c := internal.lock_queue_claim(s.post_id, s.report_id);
  actor := internal.staff_actor('queue:claim');
  perform internal.assert_queue_claim(c, actor, p_claim_generation, p_claim_nonce);
  if c.renewals >= 4 then
    raise exception 'renewal limit reached; claim the item again after it expires' using errcode = 'PT409';
  end if;
  update private.queue_claims set claim_expires_at = clock_timestamp() + interval '15 minutes', renewals = renewals + 1
  where id = c.id returning * into c;
  return internal.queue_claim_view(c);
end;
$$;
revoke all on function internal.renew_queue_claim(text, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.renew_queue_claim(text, uuid, text, uuid) to authenticated;
create function api.renew_queue_claim(p_subject text, p_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.renew_queue_claim(p_subject, p_id, p_claim_generation, p_claim_nonce);
$$;
revoke all on function api.renew_queue_claim(text, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.renew_queue_claim(text, uuid, text, uuid) to authenticated;

-- Holder: give an item back to the queue.
create function internal.release_queue_claim(p_subject text, p_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:claim'); s record;
begin
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  actor := internal.staff_actor('queue:claim');
  perform internal.consume_queue_claim(p_subject, p_id, actor, p_claim_generation, p_claim_nonce);
  perform internal.staff_actor('queue:claim'); -- authority after the claim-row wait
  return jsonb_build_object('subject', p_subject, 'id', p_id, 'status', 'released');
end;
$$;
revoke all on function internal.release_queue_claim(text, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.release_queue_claim(text, uuid, text, uuid) to authenticated;
create function api.release_queue_claim(p_subject text, p_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.release_queue_claim(p_subject, p_id, p_claim_generation, p_claim_nonce);
$$;
revoke all on function api.release_queue_claim(text, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.release_queue_claim(text, uuid, text, uuid) to authenticated;

-- Governor/admin: free a live claim (p_to null) or hand it to another eligible
-- reviewer, with a reason. The new holder reads the tuple from my_queue_claims.
create function internal.reassign_queue_claim(p_subject text, p_id uuid, p_to uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:reassign'); s record; c private.queue_claims; reason text; previous uuid;
begin
  reason := internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb, to_jsonb(p_reason)) #>> '{}';
  if reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode = '22023';
  end if;
  -- The new holder's guard comes first, as in claim acquisition, so the cap
  -- check below cannot race the holder's own claims or another reassignment.
  if p_to is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_to::text, 1201));
  end if;
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  c := internal.lock_queue_claim(s.post_id, s.report_id);
  actor := internal.staff_actor('queue:reassign');
  if internal.queue_conflict(actor, s.post_id, s.report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  if c.id is null or c.claimed_by is null or c.claim_expires_at <= clock_timestamp() then
    raise exception 'nobody holds this item' using errcode = 'PT409';
  end if;
  previous := c.claimed_by;
  if p_to is null then
    update private.queue_claims set claimed_by = null, claim_nonce = null, claimed_at = null,
      claim_expires_at = null, renewals = 0
    where id = c.id;
  else
    if p_to = previous then raise exception 'that reviewer already holds this item' using errcode = '22023'; end if;
    if not exists (select 1 from private.staff_roles r join private.staff_capabilities k on k.role = r.role
        join private.current_account_access u on u.id = r.user_id
        where r.user_id = p_to and r.revoked_at is null and k.capability = 'queue:claim')
      or internal.queue_conflict(p_to, s.post_id, s.report_id) then
      raise exception 'choose an independent reviewer who works this queue' using errcode = '22023';
    end if;
    if (select count(*) from private.queue_claims q where q.claimed_by = p_to and q.claim_expires_at > clock_timestamp()) >= 20 then
      raise exception 'that reviewer already holds 20 items' using errcode = 'PT429';
    end if;
    update private.queue_claims set claimed_by = p_to, claim_generation = claim_generation + 1,
      claim_nonce = pg_catalog.gen_random_uuid(), claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp() + interval '15 minutes', renewals = 0
    where id = c.id and claim_generation < 9223372036854775807 returning * into c;
    if c.id is null then raise exception 'claim generation exhausted' using errcode = 'PT409'; end if;
  end if;
  insert into private.queue_claim_events (post_id, report_id, actor_id, event, from_staff, to_staff, claim_generation, reason)
  values (s.post_id, s.report_id, actor, case when p_to is null then 'released_by_staff' else 'reassigned' end,
    previous, p_to, c.claim_generation, reason);
  return jsonb_build_object('subject', p_subject, 'id', p_id,
    'status', case when p_to is null then 'released' else 'reassigned' end, 'claim_generation', c.claim_generation::text);
end;
$$;
revoke all on function internal.reassign_queue_claim(text, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.reassign_queue_claim(text, uuid, uuid, text) to authenticated;
create function api.reassign_queue_claim(p_subject text, p_id uuid, p_to uuid, p_reason text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.reassign_queue_claim(p_subject, p_id, p_to, p_reason);
$$;
revoke all on function api.reassign_queue_claim(text, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.reassign_queue_claim(text, uuid, uuid, text) to authenticated;

-- Holder: my live claims, with their tuples (after a reload or a reassignment).
create function internal.my_queue_claims()
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:claim');
begin
  return coalesce((select jsonb_agg(internal.queue_claim_view(q) order by q.claim_expires_at, q.id)
    from private.queue_claims q where q.claimed_by = actor and q.claim_expires_at > clock_timestamp()), '[]'::jsonb);
end;
$$;
revoke all on function internal.my_queue_claims() from public, anon, authenticated, service_role;
grant execute on function internal.my_queue_claims() to authenticated;
create function api.my_queue_claims()
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.my_queue_claims();
$$;
revoke all on function api.my_queue_claims() from public, anon, authenticated, service_role;
grant execute on function api.my_queue_claims() to authenticated;

-- What a reviewer sees of a post: the submitted content, details and media,
-- whether or not it is public. Object keys are random (public pages show them).
create function internal.post_review_view(p_post_id uuid)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'area', p.area, 'category', p.category_key,
    'activity', p.activity_key, 'status', p.status, 'revision', p.revision, 'edit_of', p.edit_of,
    'title', p.title, 'description', p.description, 'province', p.province_id, 'city', p.city_id,
    'locality', p.locality_label, 'submitted_at', p.submitted_at,
    'price_mode', l.price_mode, 'price_cents', l.price_cents::text, 'price_negotiable', l.price_negotiable,
    'attributes', l.attributes, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'timezone', e.timezone,
    'media', coalesce((select jsonb_agg(jsonb_build_object('purpose', pm.purpose, 'position', pm.position,
        'object_key', m.object_key, 'kind', m.kind, 'state', m.state, 'width', m.width, 'height', m.height)
        order by pm.purpose, pm.position)
      from private.post_media pm join private.media_objects m on m.id = pm.object_id where pm.post_id = p.id), '[]'))
  from private.posts p
  left join private.listing_details l on l.post_id = p.id
  left join private.event_details e on e.post_id = p.id
  where p.id = p_post_id;
$$;
revoke all on function internal.post_review_view(uuid) from public, anon, authenticated, service_role;

-- Staff: review DTO for a claimed post. An edit also shows the live version.
create function internal.staff_review_post(p_post_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('post:moderate'); c private.queue_claims; dto jsonb;
begin
  select q.* into c from private.queue_claims q join private.posts p on p.id = q.post_id
    where q.post_id = p_post_id and p.status = 'pending_moderation';
  if internal.queue_conflict(actor, p_post_id, null) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  perform internal.assert_queue_claim(c, actor, p_claim_generation, p_claim_nonce);
  dto := internal.post_review_view(p_post_id);
  if dto->>'edit_of' is not null then
    dto := dto || jsonb_build_object('live_version', internal.post_review_view((dto->>'edit_of')::uuid));
  end if;
  return dto;
end;
$$;
revoke all on function internal.staff_review_post(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.staff_review_post(uuid, text, uuid) to authenticated;
create function api.staff_review_post(p_post_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.staff_review_post(p_post_id, p_claim_generation, p_claim_nonce);
$$;
revoke all on function api.staff_review_post(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.staff_review_post(uuid, text, uuid) to authenticated;

-- Server only (after Turnstile and rate limiting): file a report about a post
-- that is public right now. The route passes the verified reporter account,
-- if any, and an HMAC of the client IP; the database never sees the IP.
create function internal.submit_report(p_post_id uuid, p_category text, p_description text,
  p_reporter_id uuid, p_reporter_ip_hmac text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare subject uuid; body text; report_id uuid;
begin
  if p_category is null or p_category not in ('scam', 'prohibited_item', 'impersonation', 'harassment', 'misleading_info') then
    raise exception 'choose a report reason' using errcode = '22023';
  end if;
  if p_reporter_ip_hmac is null or p_reporter_ip_hmac !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'reporter fingerprint required' using errcode = '22023';
  end if;
  body := internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":2000}'::jsonb,
    to_jsonb(p_description)) #>> '{}';
  if body ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode = '22023';
  end if;
  if p_reporter_id is not null and not exists (select 1 from private.current_account_access u where u.id = p_reporter_id) then
    raise exception 'reporter account is not active' using errcode = '42501';
  end if;
  select p.owner_id into subject from private.posts p
    where p.id = p_post_id and exists (select 1 from private.public_eligible_posts e where e.id = p.id);
  if subject is null then raise exception 'post not found' using errcode = '22023'; end if;
  if subject = p_reporter_id then raise exception 'you cannot report your own post' using errcode = '22023'; end if;
  begin
    insert into private.reports (post_id, subject_account_id, category, description, reporter_id, reporter_ip_hmac)
    values (p_post_id, subject, p_category, body, p_reporter_id, p_reporter_ip_hmac)
    returning id into report_id;
  exception when unique_violation then
    raise exception 'you already reported this post' using errcode = 'PT409';
  end;
  return jsonb_build_object('id', report_id, 'status', 'open');
end;
$$;
revoke all on function internal.submit_report(uuid, text, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.submit_report(uuid, text, text, uuid, text) to service_role;
create function api.submit_report(p_post_id uuid, p_category text, p_description text,
  p_reporter_ip_hmac text, p_reporter_id uuid default null)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.submit_report(p_post_id, p_category, p_description, p_reporter_id, p_reporter_ip_hmac);
$$;
revoke all on function api.submit_report(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.submit_report(uuid, text, text, text, uuid) to service_role;

-- Staff: review DTO for a claimed report. The reporter's identity is not shown;
-- whether they were signed in, and the subject's open-report count, are.
create function internal.staff_review_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('report:resolve'); c private.queue_claims; r private.reports;
begin
  select * into r from private.reports x where x.id = p_report_id and x.status = 'open';
  select q.* into c from private.queue_claims q where q.report_id = r.id;
  if internal.queue_conflict(actor, null, p_report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  perform internal.assert_queue_claim(c, actor, p_claim_generation, p_claim_nonce);
  return jsonb_build_object('id', r.id, 'category', r.category, 'severity', r.severity,
    'description', r.description, 'status', r.status, 'created_at', r.created_at,
    'reporter_signed_in', r.reporter_id is not null, 'subject_account_id', r.subject_account_id,
    'subject_open_reports', (select count(*) from private.reports x
      where x.subject_account_id = r.subject_account_id and x.status = 'open'),
    'post', case when r.post_id is not null then internal.post_review_view(r.post_id) end);
end;
$$;
revoke all on function internal.staff_review_report(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.staff_review_report(uuid, text, uuid) to authenticated;
create function api.staff_review_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.staff_review_report(p_report_id, p_claim_generation, p_claim_nonce);
$$;
revoke all on function api.staff_review_report(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.staff_review_report(uuid, text, uuid) to authenticated;

-- Staff: close a claimed report. Enforcement effects (take-down, restrictions,
-- appeals) are a separate slice and must use this same claim.
create function internal.resolve_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid,
  p_outcome text, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('report:resolve'); s record; note text;
begin
  if p_outcome is null or p_outcome not in ('resolved', 'dismissed') then
    raise exception 'outcome must be resolved or dismissed' using errcode = '22023';
  end if;
  note := internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb, to_jsonb(p_note)) #>> '{}';
  if note ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode = '22023';
  end if;
  select * into s from internal.lock_queue_subject('report', p_report_id);
  actor := internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor, null, p_report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  perform internal.consume_queue_claim('report', p_report_id, actor, p_claim_generation, p_claim_nonce);
  perform internal.staff_actor('report:resolve'); -- authority after the claim-row wait
  update private.reports set status = p_outcome, resolution_note = note, resolved_by = actor,
    resolved_at = statement_timestamp()
  where id = p_report_id;
  return jsonb_build_object('id', p_report_id, 'status', p_outcome);
end;
$$;
revoke all on function internal.resolve_report(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function internal.resolve_report(uuid, text, uuid, text, text) to authenticated;
create function api.resolve_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid,
  p_outcome text, p_note text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.resolve_report(p_report_id, p_claim_generation, p_claim_nonce, p_outcome, p_note);
$$;
revoke all on function api.resolve_report(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function api.resolve_report(uuid, text, uuid, text, text) to authenticated;

-- Source: docs/backend-foundation/prototypes/operations-costs.sql
-- Cost overview and alarms (DEC-29). Everything on the platform that grows a
-- bill is measured here from the database, compared with the free allowance of
-- the service that charges for it, and raised as an alarm at 70% and 90%.
-- Allowances are configuration, not facts: each row says where the number
-- comes from and must be re-checked against the provider's current pricing
-- (verified_on stays null until someone has done that). Usage that the
-- database cannot see (Worker requests, network egress, email provider sends)
-- is listed with its source so the dashboard shows it as "check provider".

insert into private.staff_capabilities (role, capability, requires_recent_mfa) values
  ('admin', 'cost:view', false),
  ('admin', 'cost:acknowledge', true);

create table private.cost_allowances (
  metric text primary key check (metric ~ '^[a-z_]+$'),
  label text not null check (length(label) between 3 and 120),
  unit text not null check (unit in ('bytes', 'count')),
  free_quantity numeric check (free_quantity is null or free_quantity > 0),
  period text not null check (period in ('current', 'month', 'day')),
  provider text not null check (length(provider) between 2 and 60),
  overage_note text not null check (length(overage_note) between 3 and 300),
  measured_in_database boolean not null,
  measurement text not null default 'database_observation' check(measurement in('database_observation','estimate','provider_required')),
  billing_scope text not null default 'unverified' check(billing_scope in('unverified','account','organization','project','contract')),
  source_url text check(source_url is null or source_url ~ '^https://'),
  verified_on date
);
insert into private.cost_allowances
  (metric, label, unit, free_quantity, period, provider, overage_note, measured_in_database) values
  ('object_storage_bytes', 'Photos, videos and ID documents stored', 'bytes', 10737418240, 'current', 'Cloudflare R2',
    'Free tier about 10 GB-month; beyond that billed per GB-month (check current R2 pricing)', true),
  ('object_writes_month', 'Files written this month (uploads and display copies)', 'count', 1000000, 'month', 'Cloudflare R2',
    'Class A operations: free tier about 1 million per month (check current R2 pricing)', true),
  ('database_bytes', 'Database size', 'bytes', 524288000, 'current', 'Supabase',
    'Free plan database about 500 MB per project; larger needs a paid plan (check current Supabase pricing)', true),
  ('monthly_active_users', 'People who signed in during the last 30 days', 'count', 50000, 'month', 'Supabase Auth',
    'Free plan about 50,000 monthly active users (check current Supabase pricing)', true),
  ('notifications_month', 'Notifications queued this month (emails and in-app)', 'count', null, 'month', 'Email provider',
    'Depends on the email provider plan; compare with its monthly send allowance', true),
  ('payments_month', 'Completed payments this month', 'count', null, 'month', 'Payment provider',
    'Each payment carries a provider fee; see the provider statement', true),
  ('worker_requests_day', 'Website requests per day', 'count', 100000, 'current', 'Cloudflare Workers',
    'Free plan about 100,000 requests per day; read from the Cloudflare dashboard', false),
  ('database_egress_month', 'Data sent out of the database this month', 'bytes', 5368709120, 'month', 'Supabase',
    'Free plan about 5 GB per month; read from the Supabase usage page', false);

-- Local observations are not provider bills. Reserved uploads and assumed
-- display derivatives are estimates; account entitlement/scope stays unverified.
update private.cost_allowances set measurement='estimate' where metric in('object_storage_bytes','object_writes_month');
update private.cost_allowances set measurement='provider_required' where not measured_in_database;
update private.cost_allowances set period='day' where metric='worker_requests_day';
update private.cost_allowances set source_url=case provider
  when 'Cloudflare R2' then 'https://developers.cloudflare.com/r2/pricing/'
  when 'Cloudflare Workers' then 'https://developers.cloudflare.com/workers/platform/pricing/'
  when 'Supabase' then 'https://supabase.com/pricing' end;
-- One row per metric, level and applicable UTC calendar period.
create table private.cost_alarms (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  metric text not null references private.cost_allowances (metric) on delete restrict,
  level text not null check (level in ('warning', 'critical')),
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'),
  used numeric not null check (used >= 0),
  free_quantity numeric not null check (free_quantity > 0),
  raised_at timestamptz not null default statement_timestamp(),
  acknowledged_by uuid references auth.users (id) on delete restrict,
  acknowledged_at timestamptz,
  unique (metric, level, period),
  check ((acknowledged_by is null) = (acknowledged_at is null))
);
alter table private.cost_allowances enable row level security;
alter table private.cost_alarms enable row level security;
revoke all on private.cost_allowances, private.cost_alarms from public, anon, authenticated, service_role;

-- Current usage of every metric the database can measure.
create function internal.cost_usage()
returns table (metric text, used numeric) language sql stable security invoker set search_path = pg_catalog as $$
  select 'object_storage_bytes',
    (select coalesce(sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes)), 0)
       from private.media_objects m where m.state <> 'deleted')
    -- three resized display copies per photo, about 0.5 MB together
    + (select count(*) * 524288 from private.media_objects m where m.state = 'ready' and m.kind = 'image')
    + (select coalesce(sum(a.size_bytes), 0) from private.evidence_artifacts a where a.state <> 'deleted')
  union all
  select 'object_writes_month',
    (select count(*) * 4 from private.media_objects m where m.kind = 'image'
       and m.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')
    + (select count(*) from private.media_objects m where m.kind = 'video'
       and m.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')
    + (select count(*) from private.evidence_artifacts a
       where a.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')
  union all
  select 'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database())::numeric
  union all
  select 'monthly_active_users', (select count(*) from auth.users u
    where u.last_sign_in_at > statement_timestamp() - interval '30 days')::numeric
  union all
  select 'notifications_month', (select count(*) from private.outbox_events o
    where o.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')::numeric
  union all
  select 'payments_month', (select count(*) from private.payments p where p.completed_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')::numeric;
$$;
revoke all on function internal.cost_usage() from public, anon, authenticated, service_role;

-- Admin cost dashboard: each cost line with its free allowance and level, the
-- activity that drives it, the biggest storage users and any open alarms.
create function internal.staff_cost_overview()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('cost:view');
begin
  return jsonb_build_object(
    'generated_at', statement_timestamp(),
    'lines', (select jsonb_agg(jsonb_build_object('metric', a.metric, 'label', a.label, 'unit', a.unit,
        'provider', a.provider, 'period', a.period, 'used', u.used::text,
        'free_quantity', a.free_quantity::text, 'measurement',a.measurement,'billing_scope',a.billing_scope,'source_url',a.source_url,
        'percent_of_free', case when a.free_quantity is not null and u.used is not null and a.verified_on is not null and a.billing_scope<>'unverified' and a.measurement='database_observation'
          then round(100 * u.used / a.free_quantity, 1) end,
        'level', case when u.used is null or a.measurement='provider_required' then 'check_provider'
          when a.free_quantity is null then 'allowance_unknown'
          when a.verified_on is null or a.billing_scope='unverified' then 'unverified_allowance'
          when a.measurement='estimate' then 'estimated_usage'
          when u.used >= a.free_quantity * 0.9 then 'critical'
          when u.used >= a.free_quantity * 0.7 then 'warning' else 'ok' end,
        'overage_note', a.overage_note, 'verified_on', a.verified_on) order by a.metric)
      from private.cost_allowances a left join internal.cost_usage() u on u.metric = a.metric),
    'drivers', jsonb_build_object(
      'accounts', (select count(*) from auth.users u where u.deleted_at is null),
      'new_accounts_this_month', (select count(*) from auth.users u
        where u.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC'),
      'posts_by_status', coalesce((select jsonb_object_agg(x.status, x.n) from
        (select p.status, count(*) as n from private.posts p group by p.status) x), '{}'),
      'live_posts', (select count(*) from private.posts p where p.status = 'live'),
      'uploads_last_30_days', (select count(*) from private.media_objects m
        where m.created_at > statement_timestamp() - interval '30 days'),
      'average_bytes_per_live_post', (select coalesce(round(avg(t.bytes)), 0)::text from (
        select coalesce(sum(x.bytes),0) as bytes from private.posts p left join (
          select distinct pm.post_id,m.id,greatest(coalesce(m.size_bytes,0),m.declared_bytes) as bytes
          from private.post_media pm join private.media_objects m on m.id=pm.object_id
        ) x on x.post_id=p.id where p.status='live' group by p.id) t),
      'unused_media_bytes_awaiting_cleanup', (select coalesce(sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes)), 0)::text
        from private.media_objects m where m.state in ('intent', 'rejected', 'cleanup_required')),
      'expired_posts_awaiting_deletion', (select count(*) from private.posts p where p.status in ('expired', 'sold', 'archived')),
      'evidence_files', (select count(*) from private.evidence_artifacts a where a.state <> 'deleted')),
    'largest_storage_accounts', coalesce((select jsonb_agg(jsonb_build_object('account_id',t.account_id,'bytes',t.bytes::text,'live_posts',t.live_posts,'package_posts',t.package_posts) order by t.bytes desc) from (
        select m.owner_id as account_id, sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes))::bigint as bytes,
          (select count(*) from private.posts p where p.owner_id = m.owner_id and p.status = 'live') as live_posts,
          (select c.posts from internal.package_capacity(m.owner_id) c) as package_posts
        from (
          select owner_id,greatest(coalesce(size_bytes,0),declared_bytes) as declared_bytes,size_bytes
          from private.media_objects where state<>'deleted'
          union all
          select owner_id,coalesce(size_bytes,0),size_bytes from private.evidence_artifacts where state<>'deleted'
        ) m group by m.owner_id order by 2 desc,m.owner_id limit 10) t), '[]'),
    'open_alarms', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'metric', c.metric, 'level', c.level,
        'period', c.period, 'used', c.used::text, 'free_quantity', c.free_quantity::text, 'raised_at', c.raised_at)
        order by c.raised_at desc)
      from private.cost_alarms c where c.acknowledged_at is null), '[]'));
end;
$$;
revoke all on function internal.staff_cost_overview() from public, anon, authenticated, service_role;
grant execute on function internal.staff_cost_overview() to authenticated;
create function api.staff_cost_overview()
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.staff_cost_overview();
$$;
revoke all on function api.staff_cost_overview() from public, anon, authenticated, service_role;
grant execute on function api.staff_cost_overview() to authenticated;

-- Server job, run hourly: raise each metric's warning (70%) and critical (90%)
-- alarm once per month. Returns how many new alarms were raised.
create function internal.check_cost_alarms()
returns integer language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  insert into private.cost_alarms (metric, level, period, used, free_quantity)
  select a.metric, l.level, to_char(statement_timestamp() at time zone 'UTC', case when a.period='day' then 'YYYY-MM-DD' else 'YYYY-MM' end), u.used, a.free_quantity
  from private.cost_allowances a join internal.cost_usage() u on u.metric = a.metric
  cross join (values ('warning', 0.7), ('critical', 0.9)) l (level, share)
  where a.measurement='database_observation' and a.verified_on is not null and a.billing_scope<>'unverified' and a.free_quantity is not null and u.used >= a.free_quantity * l.share
  on conflict (metric, level, period) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function internal.check_cost_alarms() from public, anon, authenticated, service_role;
grant execute on function internal.check_cost_alarms() to service_role;
create function api.check_cost_alarms()
returns integer language sql security invoker set search_path = pg_catalog as $$
  select internal.check_cost_alarms();
$$;
revoke all on function api.check_cost_alarms() from public, anon, authenticated, service_role;
grant execute on function api.check_cost_alarms() to service_role;

-- Admin: mark an alarm as seen. It stays recorded.
create function internal.acknowledge_cost_alarm(p_alarm_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('cost:acknowledge'); alarm private.cost_alarms;
begin
  update private.cost_alarms set acknowledged_by = actor, acknowledged_at = statement_timestamp()
  where id = p_alarm_id and acknowledged_at is null returning * into alarm;
  if alarm.id is null then raise exception 'open alarm not found' using errcode = '22023'; end if;
  actor:=internal.staff_actor('cost:acknowledge'); -- final authority after the alarm row wait
  return jsonb_build_object('id', alarm.id, 'acknowledged_at', alarm.acknowledged_at);
end;
$$;
revoke all on function internal.acknowledge_cost_alarm(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.acknowledge_cost_alarm(uuid) to authenticated;
create function api.acknowledge_cost_alarm(p_alarm_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.acknowledge_cost_alarm(p_alarm_id);
$$;
revoke all on function api.acknowledge_cost_alarm(uuid) from public, anon, authenticated, service_role;
grant execute on function api.acknowledge_cost_alarm(uuid) to authenticated;

-- Source: docs/backend-foundation/prototypes/identity-verification.sql
-- Trusted verification facts. Local candidate, never a hosted migration.
-- Processing assertions are not accepted identities. Only independent reviewed
-- ID-number/document/selfie attestations establish an accepted fingerprint.
create table private.verification_phone_challenges (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  phone text not null check(phone ~ '^\+27[0-9]{9}$'),
  otp_hash text not null check(length(otp_hash) between 16 and 512),
  attempts integer not null default 0 check(attempts between 0 and 5),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '5 minutes',
  verified_at timestamptz,
  check(expires_at>created_at), unique(id,owner_id)
);
create index verification_phone_challenges_owner_idx on private.verification_phone_challenges(owner_id,id);
create table private.verification_phone_proofs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  challenge_id uuid not null unique,
  phone text not null check(phone ~ '^\+27[0-9]{9}$'),
  verified_at timestamptz not null default clock_timestamp(),
  contact_changed_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  foreign key(challenge_id,owner_id) references private.verification_phone_challenges(id,owner_id)
);
create unique index verification_phone_owner_active_idx on private.verification_phone_proofs(owner_id) where revoked_at is null;
create unique index verification_phone_unique_active_idx on private.verification_phone_proofs(phone) where revoked_at is null;
create table private.verification_localities (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  province_id text not null,
  city_id text not null,
  assurance text not null default 'self_declared' check(assurance='self_declared'),
  confirmed_at timestamptz not null default clock_timestamp(),
  foreign key(city_id,province_id) references private.cities(id,province_id)
);
create table private.verification_identity_submissions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  case_id uuid not null,
  owner_id uuid not null,
  case_version integer not null check(case_version>0),
  id_artifact_id uuid not null references private.evidence_artifacts(id),
  selfie_artifact_id uuid not null references private.evidence_artifacts(id),
  identity_hmac text not null check(identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  identity_key_id text not null check(identity_key_id='identity-match-v1'),
  protocol text not null default 'sa-id-hmac-sha256-v1' check(protocol='sa-id-hmac-sha256-v1'),
  -- Source-compatible AES256-GCM:13 ASCII digits,96-bit nonce,128-bit tag.
  -- Worker must use AAD owner_id||':id_doc'; DB never receives the encryption key.
  number_ciphertext text not null check(number_ciphertext ~ '^[a-f0-9]{26}$'),
  number_iv text not null check(number_iv ~ '^[a-f0-9]{24}$'),
  number_tag text not null check(number_tag ~ '^[a-f0-9]{32}$'),
  encryption_key_id text not null check(encryption_key_id='identity-number-v1'),
  receipt_id uuid not null unique,
  recipe text not null check(recipe='manual-id-selfie-v1'),
  risk_score integer not null check(risk_score between 0 and 100),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(case_id,owner_id) references private.evidence_cases(id,subject_id),
  unique(id,owner_id), check(id_artifact_id<>selfie_artifact_id)
);
create index verification_submissions_case_idx on private.verification_identity_submissions(case_id,id);
create index verification_submissions_owner_idx on private.verification_identity_submissions(owner_id,id);
create table private.verification_current_submissions (
  case_id uuid primary key references private.evidence_cases(id),
  submission_id uuid not null unique references private.verification_identity_submissions(id)
);
create table private.accepted_identity_facts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  submission_id uuid not null unique,
  identity_hmac text not null check(identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  reviewed_by uuid not null references auth.users(id),
  second_reviewer uuid references auth.users(id),
  decision_id uuid unique references private.decisions(id),
  reviewed_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  foreign key(submission_id,owner_id) references private.verification_identity_submissions(id,owner_id),
  check(owner_id<>reviewed_by and owner_id is distinct from second_reviewer),
  check((second_reviewer is null)=(decision_id is null)),
  check(second_reviewer is distinct from reviewed_by)
);
create unique index accepted_identity_owner_active_idx on private.accepted_identity_facts(owner_id) where revoked_at is null;
create unique index accepted_identity_fingerprint_active_idx on private.accepted_identity_facts(identity_hmac) where revoked_at is null;
create table private.identity_review_proposals (
  decision_id uuid primary key references private.decisions(id),
  submission_id uuid not null references private.verification_identity_submissions(id),
  reviewer_session uuid not null,
  reviewed_at timestamptz not null default clock_timestamp()
);
-- This copy has the ban's explicit5-year deadline. Generic immutable decisions
-- store only an opaque fact ID/category, never another permanent fingerprint.
create table private.identity_ban_bindings (
  decision_id uuid primary key references private.decisions(id),
  fact_id uuid not null,
  identity_hmac text not null check(identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  category text not null check(category in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other')),
  approved_at timestamptz not null,
  retain_until timestamptz not null,
  check(retain_until=approved_at+interval '5 years')
);
create index identity_ban_bindings_expiry_idx on private.identity_ban_bindings(retain_until);
create table private.identity_ban_proposal_requests (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  fact_id uuid not null,
  category text not null check(category in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other')),
  decision_id uuid not null unique references private.decisions(id)
);
alter table private.identity_ban_proposal_requests enable row level security;
revoke all on private.identity_ban_proposal_requests from public,anon,authenticated,service_role;

alter table private.verification_phone_challenges enable row level security;
alter table private.verification_phone_proofs enable row level security;
alter table private.verification_localities enable row level security;
alter table private.verification_identity_submissions enable row level security;
alter table private.verification_current_submissions enable row level security;
alter table private.accepted_identity_facts enable row level security;
alter table private.identity_review_proposals enable row level security;
alter table private.identity_ban_bindings enable row level security;
revoke all on private.verification_phone_challenges,private.verification_phone_proofs,
  private.verification_localities,private.verification_identity_submissions,
  private.verification_current_submissions,private.accepted_identity_facts,
  private.identity_review_proposals,private.identity_ban_bindings from public,anon,authenticated,service_role;

create function internal.lock_verification_subject(p_owner uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform internal.lock_evidence_subject(p_owner);
  perform c.id from private.evidence_cases c where c.subject_id=p_owner order by c.id for update;
end;
$$;
revoke all on function internal.lock_verification_subject(uuid) from public,anon,authenticated,service_role;

create function internal.verification_submission_immutable()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception 'verification submission is immutable; replace with a new receipt' using errcode='23514';
end;
$$;
revoke all on function internal.verification_submission_immutable() from public,anon,authenticated,service_role;
create trigger verification_submission_immutable before update on private.verification_identity_submissions
  for each row execute function internal.verification_submission_immutable();

create function internal.verification_artifacts_ready(p_submission uuid)
returns boolean language sql volatile security invoker set search_path=pg_catalog as $$
  select exists(select 1 from private.verification_identity_submissions s
    join private.evidence_artifacts i on i.id=s.id_artifact_id and i.owner_id=s.owner_id and i.case_id=s.case_id
    join private.evidence_artifacts f on f.id=s.selfie_artifact_id and f.owner_id=s.owner_id and f.case_id=s.case_id
    where s.id=p_submission and i.purpose='id_front' and f.purpose='selfie'
      and i.state='clean' and f.state='clean'
      and (i.retain_until is null or i.retain_until>clock_timestamp())
      and (f.retain_until is null or f.retain_until>clock_timestamp()));
$$;
revoke all on function internal.verification_artifacts_ready(uuid) from public,anon,authenticated,service_role;

create function internal.open_verification_case()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); c private.evidence_cases;
begin
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  select e.* into c from private.accepted_identity_facts f join private.verification_identity_submissions s on s.id=f.submission_id
    join private.evidence_cases e on e.id=s.case_id where f.owner_id=actor order by f.reviewed_at desc,f.id desc limit 1;
  if found then return jsonb_build_object('case_id',c.id,'version',c.version,'status','accepted','read_only',true); end if;
  select e.* into c from private.evidence_cases e where e.subject_id=actor and e.kind='kyc' and e.status='open' order by e.created_at desc,e.id limit 1;
  if not found then insert into private.evidence_cases(subject_id,kind) values(actor,'kyc') returning * into c; end if;
  return jsonb_build_object('case_id',c.id,'version',c.version,'status','open','read_only',exists(
    select 1 from private.decisions d where d.case_id=c.id and d.status='proposed' and d.action='approve_override' and d.payload ? 'identity_submission_id'));
end;
$$;
revoke all on function internal.open_verification_case() from public,anon,authenticated,service_role;
grant execute on function internal.open_verification_case() to authenticated;
create function api.open_verification_case()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.open_verification_case();
$$;
revoke all on function api.open_verification_case() from public,anon,authenticated,service_role;
grant execute on function api.open_verification_case() to authenticated;

create function internal.confirm_verification_locality(p_province text,p_city text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); prior private.verification_localities;
begin
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  if not exists(select 1 from private.cities c where c.id=p_city and c.province_id=p_province) then
    raise exception 'canonical city/province pair required' using errcode='22023'; end if;
  select l.* into prior from private.verification_localities l where l.owner_id=actor;
  if found then
    if (prior.province_id,prior.city_id) is distinct from (p_province,p_city) then
      raise exception 'approved locality requires authorised resubmission' using errcode='PT409'; end if;
    return jsonb_build_object('status','approved','assurance','self_declared','province_id',p_province,'city_id',p_city,'reused',true);
  end if;
  insert into private.verification_localities(owner_id,province_id,city_id) values(actor,p_province,p_city)
  on conflict(owner_id) do update set province_id=excluded.province_id,city_id=excluded.city_id,confirmed_at=clock_timestamp();
  return jsonb_build_object('status','approved','assurance','self_declared','province_id',p_province,'city_id',p_city);
end;
$$;
revoke all on function internal.confirm_verification_locality(text,text) from public,anon,authenticated,service_role;
grant execute on function internal.confirm_verification_locality(text,text) to authenticated;
create function api.confirm_verification_locality(p_province text,p_city text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.confirm_verification_locality(p_province,p_city);
$$;
revoke all on function api.confirm_verification_locality(text,text) from public,anon,authenticated,service_role;
grant execute on function api.confirm_verification_locality(text,text) to authenticated;

create function internal.create_verification_phone_challenge(p_owner uuid,p_phone text,p_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare challenge private.verification_phone_challenges;
begin
  perform internal.lock_verification_subject(p_owner);
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active subject required' using errcode='42501'; end if;
  if p_phone is null or p_phone !~ '^\+27[0-9]{9}$' or p_hash is null or length(p_hash) not between 16 and 512 then
    raise exception 'valid phone challenge required' using errcode='22023'; end if;
  -- New delivery invalidates older pending challenges for this subject.
  update private.verification_phone_challenges set expires_at=greatest(created_at+interval '1 microsecond',clock_timestamp())
    where owner_id=p_owner and verified_at is null and expires_at>clock_timestamp();
  insert into private.verification_phone_challenges(owner_id,phone,otp_hash) values(p_owner,p_phone,p_hash) returning * into challenge;
  return jsonb_build_object('challenge_id',challenge.id,'expires_at',challenge.expires_at);
end;
$$;
revoke all on function internal.create_verification_phone_challenge(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.create_verification_phone_challenge(uuid,text,text) to service_role;
create function api.create_verification_phone_challenge(p_owner uuid,p_phone text,p_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.create_verification_phone_challenge(p_owner,p_phone,p_hash);
$$;
revoke all on function api.create_verification_phone_challenge(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function api.create_verification_phone_challenge(uuid,text,text) to service_role;

create function internal.claim_verification_phone_attempt(p_owner uuid,p_challenge uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare challenge private.verification_phone_challenges;
begin
  perform internal.lock_verification_subject(p_owner);
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active subject required' using errcode='42501'; end if;
  update private.verification_phone_challenges set attempts=attempts+1
    where id=p_challenge and owner_id=p_owner and verified_at is null and expires_at>clock_timestamp() and attempts<5 returning * into challenge;
  if not found then raise exception 'challenge unavailable' using errcode='PT409'; end if;
  -- Trusted OTP adapter only. Never return the stored hash to a member/browser.
  return jsonb_build_object('challenge_id',challenge.id,'phone',challenge.phone,'otp_hash',challenge.otp_hash);
end;
$$;
revoke all on function internal.claim_verification_phone_attempt(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.claim_verification_phone_attempt(uuid,uuid) to service_role;
create function api.claim_verification_phone_attempt(p_owner uuid,p_challenge uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.claim_verification_phone_attempt(p_owner,p_challenge);
$$;
revoke all on function api.claim_verification_phone_attempt(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function api.claim_verification_phone_attempt(uuid,uuid) to service_role;

create function internal.finalize_verification_phone(p_owner uuid,p_challenge uuid,p_expected_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare challenge private.verification_phone_challenges; old_proof private.verification_phone_proofs; proof private.verification_phone_proofs;
begin
  perform internal.lock_verification_subject(p_owner);
  select * into challenge from private.verification_phone_challenges c where c.id=p_challenge and c.owner_id=p_owner for update;
  if not found or p_expected_hash is null or challenge.otp_hash<>p_expected_hash then
    raise exception 'challenge unavailable' using errcode='22023'; end if;
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active subject required' using errcode='42501'; end if;
  select * into old_proof from private.verification_phone_proofs f where f.owner_id=p_owner and f.revoked_at is null for update;
  if challenge.verified_at is not null then
    if old_proof.challenge_id=challenge.id and old_proof.phone=challenge.phone then
      return jsonb_build_object('verified',true,'reused',true,'proof_id',old_proof.id); end if;
    raise exception 'proof was superseded' using errcode='PT409';
  end if;
  if challenge.expires_at<=clock_timestamp() or challenge.attempts not between 1 and 5 then
    raise exception 'challenge unavailable' using errcode='22023'; end if;
  if old_proof.id is not null and old_proof.phone<>challenge.phone and
    (old_proof.contact_changed_at+interval '15 days'>clock_timestamp() or internal.current_verified_identity(p_owner) is null) then
    raise exception 'contact change not eligible' using errcode='PT409'; end if;
  update private.verification_phone_proofs set revoked_at=clock_timestamp() where id=old_proof.id;
  insert into private.verification_phone_proofs(owner_id,challenge_id,phone,contact_changed_at)
    values(p_owner,challenge.id,challenge.phone,case when old_proof.phone=challenge.phone then old_proof.contact_changed_at else clock_timestamp() end) returning * into proof;
  update private.verification_phone_challenges set verified_at=proof.verified_at where id=challenge.id;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('verification_phone_confirmed',proof.id,p_owner,'verification_phone_confirmed:'||proof.id);
  return jsonb_build_object('verified',true,'reused',false,'proof_id',proof.id);
end;
$$;
revoke all on function internal.finalize_verification_phone(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.finalize_verification_phone(uuid,uuid,text) to service_role;
create function api.finalize_verification_phone(p_owner uuid,p_challenge uuid,p_expected_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.finalize_verification_phone(p_owner,p_challenge,p_expected_hash);
$$;
revoke all on function api.finalize_verification_phone(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.finalize_verification_phone(uuid,uuid,text) to service_role;

create function internal.register_identity_submission(p_case uuid,p_expected_version integer,p_id_artifact uuid,p_selfie_artifact uuid,
  p_fingerprint text,p_identity_key text,p_encrypted_number jsonb,p_receipt uuid,p_risk_score integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.evidence_cases; s private.verification_identity_submissions; subject uuid;
begin
  if p_expected_version is null or p_expected_version not between 1 and 2147483646
    or p_fingerprint is null or p_fingerprint !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
    or p_identity_key is distinct from 'identity-match-v1' or p_receipt is null
    or p_risk_score is null or p_risk_score not between 0 and 100
    or p_encrypted_number is null or jsonb_typeof(p_encrypted_number)<>'object'
    or jsonb_typeof(p_encrypted_number->'ciphertext') is distinct from 'string'
    or jsonb_typeof(p_encrypted_number->'iv') is distinct from 'string'
    or jsonb_typeof(p_encrypted_number->'tag') is distinct from 'string'
    or jsonb_typeof(p_encrypted_number->'key_id') is distinct from 'string'
    or not(p_encrypted_number ?& array['ciphertext','iv','tag','key_id'])
    or p_encrypted_number-array['ciphertext','iv','tag','key_id']<>'{}'::jsonb
    or p_encrypted_number->>'ciphertext' !~ '^[a-f0-9]{26}$'
    or p_encrypted_number->>'iv' !~ '^[a-f0-9]{24}$' or p_encrypted_number->>'tag' !~ '^[a-f0-9]{32}$'
    or p_encrypted_number->>'key_id' is distinct from 'identity-number-v1' then
    raise exception 'bound processing receipt required' using errcode='22023'; end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_case;
  if c.kind<>'kyc' or not exists(select 1 from private.current_account_access a where a.id=subject) then
    raise exception 'active identity case required' using errcode='42501'; end if;
  if exists(select 1 from private.accepted_identity_facts f where f.owner_id=subject) then
    raise exception 'accepted identity requires authorised resubmission' using errcode='PT409'; end if;
  if c.status<>'open' then raise exception 'open identity case required' using errcode='42501'; end if;
  if exists(select 1 from private.decisions d where d.case_id=c.id and d.status='proposed'
    and d.action='approve_override' and d.payload ? 'identity_submission_id') then
    raise exception 'independent identity review is pending' using errcode='PT409'; end if;
  select x.* into s from private.verification_identity_submissions x where x.receipt_id=p_receipt;
  if found then
    if (s.case_id,s.owner_id,s.case_version,s.id_artifact_id,s.selfie_artifact_id,s.identity_hmac,s.identity_key_id,
        s.number_ciphertext,s.number_iv,s.number_tag,s.encryption_key_id,s.risk_score)
      is distinct from (c.id,subject,p_expected_version+1,p_id_artifact,p_selfie_artifact,p_fingerprint,p_identity_key,
        p_encrypted_number->>'ciphertext',p_encrypted_number->>'iv',p_encrypted_number->>'tag',p_encrypted_number->>'key_id',p_risk_score)
      or c.version<>s.case_version or not exists(select 1 from private.verification_current_submissions v where v.case_id=c.id and v.submission_id=s.id)
      or not internal.verification_artifacts_ready(s.id) then
      raise exception 'receipt retry conflicts with current submission' using errcode='PT409'; end if;
    return jsonb_build_object('submission_id',s.id,'case_version',s.case_version,'reused',true);
  end if;
  if c.version<>p_expected_version then raise exception 'case changed' using errcode='PT409'; end if;
  if not exists(select 1 from private.evidence_artifacts a where a.id=p_id_artifact and a.case_id=c.id and a.owner_id=subject
      and a.purpose='id_front' and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp()))
    or not exists(select 1 from private.evidence_artifacts a where a.id=p_selfie_artifact and a.case_id=c.id and a.owner_id=subject
      and a.purpose='selfie' and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp())) then
    raise exception 'clean subject-bound document and selfie required' using errcode='22023'; end if;
  if exists(select 1 from private.evidence_cases e where e.subject_id=subject and e.status='open' and e.kind in('kyc','business') and e.version=2147483647) then
    raise exception 'case revision exhausted' using errcode='22023'; end if;
  -- A typed-number/receipt replacement also invalidates other pending subject decisions.
  update private.evidence_cases set version=version+1 where subject_id=subject and status='open' and kind in('kyc','business');
  update private.accepted_identity_facts set revoked_at=clock_timestamp() where owner_id=subject and revoked_at is null;
  insert into private.verification_identity_submissions(case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,
    identity_hmac,identity_key_id,number_ciphertext,number_iv,number_tag,encryption_key_id,receipt_id,recipe,risk_score)
  values(c.id,subject,c.version+1,p_id_artifact,p_selfie_artifact,p_fingerprint,p_identity_key,
    p_encrypted_number->>'ciphertext',p_encrypted_number->>'iv',p_encrypted_number->>'tag',p_encrypted_number->>'key_id',p_receipt,'manual-id-selfie-v1',p_risk_score)
  returning * into s;
  insert into private.verification_current_submissions(case_id,submission_id) values(c.id,s.id)
    on conflict(case_id) do update set submission_id=excluded.submission_id;
  return jsonb_build_object('submission_id',s.id,'case_version',s.case_version,'reused',false);
end;
$$;
revoke all on function internal.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) to service_role;
create function api.register_identity_submission(p_case uuid,p_expected_version integer,p_id_artifact uuid,p_selfie_artifact uuid,
  p_fingerprint text,p_identity_key text,p_encrypted_number jsonb,p_receipt uuid,p_risk_score integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.register_identity_submission(p_case,p_expected_version,p_id_artifact,p_selfie_artifact,p_fingerprint,p_identity_key,p_encrypted_number,p_receipt,p_risk_score);
$$;
revoke all on function api.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function api.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) to service_role;

create function internal.accept_identity_submission(p_submission uuid,p_reviewer uuid,p_second uuid,p_decision uuid,
  p_claim_generation text,p_claim_nonce uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare s private.verification_identity_submissions; c private.evidence_cases; fact uuid; actor uuid;
begin
  select x.* into s from private.verification_identity_submissions x where x.id=p_submission;
  if not found then raise exception 'submission unavailable' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.identity_hmac,2701));
  actor:=internal.staff_actor(case when p_second is null then 'verification:decide_routine' else 'decision:approve' end);
  if exists(select 1 from private.banned_identities b where b.identity_hmac=s.identity_hmac and b.retain_until>clock_timestamp()) then
    raise exception 'identity cannot be accepted' using errcode='42501'; end if;
  if actor is distinct from coalesce(p_second,p_reviewer) or s.owner_id in(p_reviewer,p_second)
    or not exists(select 1 from private.current_account_access a where a.id=s.owner_id) then
    raise exception 'independent current review required' using errcode='42501'; end if;
  if p_second is not null and not exists(
    select 1 from private.identity_review_proposals r join private.decisions d on d.id=r.decision_id
    join auth.sessions session on session.id=r.reviewer_session and session.user_id=p_reviewer
    join private.staff_roles role on role.user_id=p_reviewer and role.revoked_at is null
    join private.staff_capabilities capability on capability.role=role.role and capability.capability='verification:decide_routine'
    where r.decision_id=p_decision and r.submission_id=s.id and d.status='approved' and d.proposed_by=p_reviewer
      and d.approved_by=p_second and d.case_id=s.case_id and d.case_version=s.case_version
      and r.reviewed_at+interval '15 minutes'>clock_timestamp() and session.aal='aal2'
      and (session.not_after is null or session.not_after>clock_timestamp())
      and exists(select 1 from private.current_account_access a where a.id=p_reviewer)) then
    raise exception 'current independent first review required' using errcode='42501'; end if;
  select e.* into c from private.evidence_cases e where e.id=s.case_id;
  if c.status<>'open' or c.version<>s.case_version or not internal.verification_artifacts_ready(s.id)
    or not exists(select 1 from private.verification_current_submissions v where v.case_id=c.id and v.submission_id=s.id) then
    raise exception 'reviewed submission changed' using errcode='PT409'; end if;
  if p_second is null then perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce); end if;
  if exists(select 1 from private.accepted_identity_facts f where f.identity_hmac=s.identity_hmac and f.revoked_at is null) then
    raise exception 'identity already accepted' using errcode='PT409'; end if;
  insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,second_reviewer,decision_id)
    values(s.owner_id,s.id,s.identity_hmac,p_reviewer,p_second,p_decision) returning id into fact;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('identity_accepted',fact,s.owner_id,'identity_accepted:'||fact);
  return fact;
end;
$$;
revoke all on function internal.accept_identity_submission(uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

create function internal.review_identity_submission(p_submission uuid,p_expected_version integer,p_claim_generation text,p_claim_nonce uuid,
  p_number_matches boolean,p_selfie_matches boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('verification:decide_routine'); s private.verification_identity_submissions;
  c private.evidence_cases; fact uuid; proposal jsonb;
begin
  if p_number_matches is distinct from true or p_selfie_matches is distinct from true or p_expected_version is null then
    raise exception 'exact number/document and selfie attestations required' using errcode='22023'; end if;
  select x.* into s from private.verification_identity_submissions x where x.id=p_submission;
  if not found then raise exception 'submission unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(s.owner_id);
  actor:=internal.staff_actor('verification:decide_routine');
  if not exists(select 1 from private.current_account_access a where a.id=s.owner_id) then
    raise exception 'active identity subject required' using errcode='42501'; end if;
  select e.* into c from private.evidence_cases e where e.id=s.case_id;
  select f.id into fact from private.accepted_identity_facts f where f.submission_id=s.id and f.revoked_at is null
    and f.reviewed_by=actor and f.second_reviewer is null and s.case_version=p_expected_version;
  if found and c.status='decided' and c.version=s.case_version+1 and internal.verification_artifacts_ready(s.id) then
    return jsonb_build_object('status','accepted','identity_fact_id',fact,'reused',true); end if;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  if c.kind<>'kyc' or c.version<>p_expected_version or s.case_version<>c.version
    or not internal.verification_artifacts_ready(s.id)
    or not exists(select 1 from private.verification_current_submissions v where v.case_id=c.id and v.submission_id=s.id) then
    raise exception 'reviewed submission changed' using errcode='PT409'; end if;
  if s.risk_score>50 then
    proposal:=internal.propose_decision(c.id,c.version,'approve_override',jsonb_build_object('identity_submission_id',s.id));
    insert into private.identity_review_proposals(decision_id,submission_id,reviewer_session)
      values((proposal->>'decision_id')::uuid,s.id,(auth.jwt()->>'session_id')::uuid);
    return jsonb_build_object('status','awaiting_second_reviewer','decision_id',proposal->>'decision_id');
  end if;
  fact:=internal.accept_identity_submission(s.id,actor,null,null,p_claim_generation,p_claim_nonce);
  update private.evidence_cases set status='decided',version=version+1,claimed_by=null,claim_expires_at=null,claim_nonce=null where id=c.id and version<2147483647;
  if not found then raise exception 'case revision exhausted' using errcode='22023'; end if;
  return jsonb_build_object('status','accepted','identity_fact_id',fact);
end;
$$;
revoke all on function internal.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) to authenticated;
create function api.review_identity_submission(p_submission uuid,p_expected_version integer,p_claim_generation text,p_claim_nonce uuid,
  p_number_matches boolean,p_selfie_matches boolean)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.review_identity_submission(p_submission,p_expected_version,p_claim_generation,p_claim_nonce,p_number_matches,p_selfie_matches);
$$;
revoke all on function api.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function api.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) to authenticated;

create function internal.verification_identity_fact_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.owner_id,new.submission_id,new.identity_hmac,new.reviewed_by,new.second_reviewer,new.decision_id,new.reviewed_at)
    is distinct from (old.id,old.owner_id,old.submission_id,old.identity_hmac,old.reviewed_by,old.second_reviewer,old.decision_id,old.reviewed_at)
    or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'accepted identity facts are immutable except first revocation' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function internal.verification_identity_fact_guard() from public,anon,authenticated,service_role;
create trigger verification_identity_fact_guard before update on private.accepted_identity_facts
  for each row execute function internal.verification_identity_fact_guard();

create function internal.verification_evidence_invalidation()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare subject uuid; case_id uuid; material boolean; changed integer;
begin
  subject:=case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  case_id:=case when tg_op='DELETE' then old.case_id else new.case_id end;
  material:=tg_op<>'UPDATE';
  if tg_op='UPDATE' then material:=(new.state,new.sha256,new.size_bytes) is distinct from (old.state,old.sha256,old.size_bytes); end if;
  if material and exists(select 1 from private.evidence_cases c where c.id=case_id and c.kind='kyc') then
    perform internal.lock_verification_subject(subject);
    update private.accepted_identity_facts set revoked_at=clock_timestamp() where owner_id=subject and revoked_at is null;
    get diagnostics changed=row_count;
    if changed>0 and not exists(select 1 from private.account_closures x where x.user_id=subject) then
      if exists(select 1 from private.evidence_cases c where c.subject_id=subject and c.status='open' and c.kind in('kyc','business') and c.version=2147483647) then
        raise exception 'case revision exhausted' using errcode='22023'; end if;
      update private.evidence_cases set version=version+1 where subject_id=subject and status='open' and kind in('kyc','business');
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function internal.verification_evidence_invalidation() from public,anon,authenticated,service_role;
create trigger verification_evidence_invalidation after insert or update or delete on private.evidence_artifacts
  for each row execute function internal.verification_evidence_invalidation();

create function internal.verification_closure_invalidation()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform internal.lock_verification_subject(new.user_id);
  update private.accepted_identity_facts set revoked_at=clock_timestamp() where owner_id=new.user_id and revoked_at is null;
  update private.verification_phone_proofs set revoked_at=clock_timestamp() where owner_id=new.user_id and revoked_at is null;
  return new;
end;
$$;
revoke all on function internal.verification_closure_invalidation() from public,anon,authenticated,service_role;
create trigger verification_closure_invalidation after insert on private.account_closures
  for each row execute function internal.verification_closure_invalidation();

create function internal.verification_decision_proposal_binding()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare subject uuid;
begin
  if new.action='restrict_account' and (new.payload ? 'identity_fact_id' or new.payload ? 'identity_ban_category') then
    if new.payload-array['identity_fact_id','identity_ban_category']<>'{}'::jsonb then
      raise exception 'unknown identity ban payload fields' using errcode='22023'; end if;
    select c.subject_id into subject from private.evidence_cases c where c.id=new.case_id;
    if not exists(select 1 from private.accepted_identity_facts f where f.id::text=new.payload->>'identity_fact_id'
      and f.owner_id=subject)
      or new.payload->>'identity_ban_category' is null
      or new.payload->>'identity_ban_category' not in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other') then
      raise exception 'current subject identity and explicit category required' using errcode='22023'; end if;
  elsif new.action='approve_override' and new.payload ? 'identity_submission_id' then
    if new.payload-array['identity_submission_id']<>'{}'::jsonb then
      raise exception 'unknown identity review payload fields' using errcode='22023'; end if;
  end if;
  return new;
end;
$$;
revoke all on function internal.verification_decision_proposal_binding() from public,anon,authenticated,service_role;
create trigger verification_decision_proposal_binding before insert on private.decisions
  for each row execute function internal.verification_decision_proposal_binding();

create function internal.verification_decision_effect()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare binding private.identity_review_proposals; s private.verification_identity_submissions;
  fact private.accepted_identity_facts; c private.evidence_cases; actor uuid; category text;
begin
  if new.status<>'approved' then return new; end if;
  if new.action='approve_override' and new.payload ? 'identity_submission_id' then
    select p.* into binding from private.identity_review_proposals p where p.decision_id=new.id;
    if not found or binding.submission_id::text is distinct from new.payload->>'identity_submission_id' then
      raise exception 'typed identity review proposal required' using errcode='42501'; end if;
    perform internal.accept_identity_submission(binding.submission_id,new.proposed_by,new.approved_by,new.id,null,null);
  elsif new.action='restrict_account' and (new.payload ? 'identity_fact_id' or new.payload ? 'identity_ban_category') then
    select e.* into c from private.evidence_cases e where e.id=new.case_id;
    select f.* into fact from private.accepted_identity_facts f
      where f.id::text=new.payload->>'identity_fact_id' and f.owner_id=c.subject_id;
    if not found then raise exception 'reviewed subject identity required' using errcode='PT409'; end if;
    category:=new.payload->>'identity_ban_category';
    if category is null or category not in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other') then
      raise exception 'explicit identity ban category required' using errcode='22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fact.identity_hmac,2701));
    actor:=internal.staff_actor('decision:approve');
    if actor is distinct from new.approved_by then raise exception 'current independent approver required' using errcode='42501'; end if;
    insert into private.identity_ban_bindings(decision_id,fact_id,identity_hmac,category,approved_at,retain_until)
      values(new.id,fact.id,fact.identity_hmac,category,new.approved_at,new.approved_at+interval '5 years');
    perform internal.record_identity_ban(new.id,fact.identity_hmac,category);
  end if;
  return new;
end;
$$;
revoke all on function internal.verification_decision_effect() from public,anon,authenticated,service_role;
create trigger verification_decision_effect after update of status on private.decisions
  for each row when(new.status='approved' and old.status='proposed') execute function internal.verification_decision_effect();

create function internal.current_verified_identity(p_owner uuid)
returns text language sql volatile security invoker set search_path=pg_catalog as $$
  select f.identity_hmac from private.accepted_identity_facts f
    join private.verification_identity_submissions s on s.id=f.submission_id
    join private.evidence_cases c on c.id=s.case_id and c.subject_id=p_owner
  where f.owner_id=p_owner and f.revoked_at is null and c.status='decided' and c.version=s.case_version+1
    and internal.verification_artifacts_ready(s.id)
    and exists(select 1 from private.current_account_access a where a.id=p_owner)
    and exists(select 1 from private.verification_phone_proofs p where p.owner_id=p_owner and p.revoked_at is null)
    and exists(select 1 from private.verification_localities l where l.owner_id=p_owner);
$$;
revoke all on function internal.current_verified_identity(uuid) from public,anon,authenticated,service_role;

create function internal.grant_verified_intro_trial(p_owner uuid,p_days integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare fingerprint text;
begin
  perform internal.lock_verification_subject(p_owner);
  fingerprint:=internal.current_verified_identity(p_owner);
  if fingerprint is null then raise exception 'current complete verification required' using errcode='42501'; end if;
  if exists(select 1 from private.trial_identities t where t.owner_id=p_owner and t.identity_hmac<>fingerprint) then
    return jsonb_build_object('granted',false,'reason','account_already_used'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint,2701));
  if internal.current_verified_identity(p_owner) is distinct from fingerprint then
    raise exception 'verification changed' using errcode='42501'; end if;
  return internal.grant_intro_trial(p_owner,fingerprint,p_days);
end;
$$;
revoke all on function internal.grant_verified_intro_trial(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.grant_verified_intro_trial(uuid,integer) to service_role;
create function api.grant_verified_intro_trial(p_owner uuid,p_days integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.grant_verified_intro_trial(p_owner,p_days);
$$;
revoke all on function api.grant_verified_intro_trial(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function api.grant_verified_intro_trial(uuid,integer) to service_role;

create function internal.reconcile_verified_identity_ban(p_decision uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare binding private.identity_ban_bindings; subject uuid;
begin
  select c.subject_id into subject from private.decisions d join private.evidence_cases c on c.id=d.case_id
    where d.id=p_decision and d.status='approved' and d.action='restrict_account';
  if not found then raise exception 'approved identity ban required' using errcode='42501'; end if;
  perform internal.lock_verification_subject(subject);
  select b.* into binding from private.identity_ban_bindings b where b.decision_id=p_decision;
  if not found then raise exception 'reviewed identity ban binding unavailable' using errcode='42501'; end if;
  return internal.record_identity_ban(binding.decision_id,binding.identity_hmac,binding.category);
end;
$$;
revoke all on function internal.reconcile_verified_identity_ban(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.reconcile_verified_identity_ban(uuid) to service_role;
create function api.reconcile_verified_identity_ban(p_decision uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.reconcile_verified_identity_ban(p_decision);
$$;
revoke all on function api.reconcile_verified_identity_ban(uuid) from public,anon,authenticated,service_role;
grant execute on function api.reconcile_verified_identity_ban(uuid) to service_role;

-- Staff can open a restriction case without cooperation from the verified owner.
-- An explicit operation UUID makes a lost-response retry return the same decision.
create function internal.propose_verified_identity_ban(p_owner uuid,p_fact uuid,p_category text,p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:propose'); prior private.identity_ban_proposal_requests;
  case_id uuid; proposal jsonb;
begin
  if p_request is null or p_owner is null or p_fact is null or p_category is null
    or p_category not in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other') then
    raise exception 'bound identity ban request required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(p_owner);
  actor:=internal.staff_actor('decision:propose');
  if actor=p_owner then raise exception 'independent review required' using errcode='42501'; end if;
  select r.* into prior from private.identity_ban_proposal_requests r where r.id=p_request;
  if found then
    if (prior.owner_id,prior.fact_id,prior.category) is distinct from (p_owner,p_fact,p_category) then
      raise exception 'conflicting identity ban request' using errcode='PT409'; end if;
    return jsonb_build_object('decision_id',prior.decision_id,'reused',true);
  end if;
  -- Readiness revocation by a new owner upload never erases historical review.
  -- Staff deliberately select the immutable accepted fact being enforced.
  if not exists(select 1 from private.accepted_identity_facts f where f.id=p_fact and f.owner_id=p_owner) then
    raise exception 'reviewed subject identity required' using errcode='22023'; end if;
  insert into private.evidence_cases(subject_id,kind) values(p_owner,'restriction') returning id into case_id;
  proposal:=internal.propose_decision(case_id,1,'restrict_account',jsonb_build_object('identity_fact_id',p_fact,'identity_ban_category',p_category));
  insert into private.identity_ban_proposal_requests(id,owner_id,fact_id,category,decision_id)
    values(p_request,p_owner,p_fact,p_category,(proposal->>'decision_id')::uuid);
  return jsonb_build_object('decision_id',proposal->>'decision_id','reused',false);
end;
$$;
revoke all on function internal.propose_verified_identity_ban(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.propose_verified_identity_ban(uuid,uuid,text,uuid) to authenticated;
create function api.propose_verified_identity_ban(p_owner uuid,p_fact uuid,p_category text,p_request uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.propose_verified_identity_ban(p_owner,p_fact,p_category,p_request);
$$;
revoke all on function api.propose_verified_identity_ban(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function api.propose_verified_identity_ban(uuid,uuid,text,uuid) to authenticated;

create function internal.staff_identity_review_context(p_case uuid,p_claim_generation text,p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('evidence:view'); subject uuid; c private.evidence_cases;
  s private.verification_identity_submissions;
begin
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(subject);
  actor:=internal.staff_actor('evidence:view');
  select e.* into c from private.evidence_cases e where e.id=p_case;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  select x.* into s from private.verification_identity_submissions x join private.verification_current_submissions v
    on v.submission_id=x.id and v.case_id=c.id;
  if not found or s.case_version<>c.version or not internal.verification_artifacts_ready(s.id) then
    raise exception 'current submission unavailable' using errcode='PT409'; end if;
  insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
    values(actor,c.id,'routine_review',c.version,c.claim_generation,array[s.id_artifact_id,s.selfie_artifact_id]);
  actor:=internal.staff_actor('evidence:view');
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  return jsonb_build_object('case_id',c.id,'case_version',c.version,'submission_id',s.id,'risk_score',s.risk_score,
    'recipe',s.recipe,'id_artifact_id',s.id_artifact_id,'selfie_artifact_id',s.selfie_artifact_id);
end;
$$;
revoke all on function internal.staff_identity_review_context(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.staff_identity_review_context(uuid,text,uuid) to authenticated;
create function api.staff_identity_review_context(p_case uuid,p_claim_generation text,p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.staff_identity_review_context(p_case,p_claim_generation,p_claim_nonce);
$$;
revoke all on function api.staff_identity_review_context(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function api.staff_identity_review_context(uuid,text,uuid) to authenticated;

-- Staff discovery of opaque accepted-identity references. No raw identity data.
create index accepted_identity_history_owner_idx on private.accepted_identity_facts(owner_id,reviewed_at desc,id desc);
create index decisions_case_lookup_idx on private.decisions(case_id,id);
alter table private.evidence_access_log add column identity_fact_ids uuid[] not null default '{}';
create function internal.staff_identity_history(p_owner uuid,p_before_time timestamptz,p_before_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:propose'); c private.evidence_cases;
  items jsonb; more boolean; ids uuid[]; fact_ids uuid[]; cursor jsonb;
begin
  perform internal.staff_actor('evidence:view');
  perform internal.staff_actor('case:claim');
  if p_owner is null or (p_before_time is null)<>(p_before_id is null) then
    raise exception 'subject and complete history cursor required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(p_owner);
  actor:=internal.staff_actor('decision:propose');
  perform internal.staff_actor('evidence:view');
  perform internal.staff_actor('case:claim');
  if actor=p_owner then raise exception 'independent review required' using errcode='42501'; end if;
  if not exists(select 1 from auth.users u where u.id=p_owner) then
    raise exception 'subject unavailable' using errcode='22023'; end if;
  select e.* into c from private.evidence_cases e where e.subject_id=p_owner and e.kind='restriction'
    and e.status='open' and ((e.claimed_by=actor and e.claim_expires_at>clock_timestamp())
      or ((e.claim_expires_at is null or e.claim_expires_at<=clock_timestamp()) and e.claim_generation<9223372036854775807))
    and not exists(select 1 from private.decisions d where d.case_id=e.id)
    order by (e.claimed_by=actor and e.claim_expires_at>clock_timestamp()) desc nulls last,e.created_at desc,e.id desc limit 1;
  if not found then
    insert into private.evidence_cases(subject_id,kind,claimed_by,claim_expires_at,claim_generation,claim_nonce)
      values(p_owner,'restriction',actor,clock_timestamp()+interval '30 minutes',1,pg_catalog.gen_random_uuid()) returning * into c;
  elsif c.claimed_by is distinct from actor or c.claim_expires_at is null or c.claim_expires_at<=clock_timestamp() then
    update private.evidence_cases set claimed_by=actor,claim_expires_at=clock_timestamp()+interval '30 minutes',
      claim_generation=claim_generation+1,claim_nonce=pg_catalog.gen_random_uuid() where id=c.id and claim_generation<9223372036854775807 returning * into c;
    if not found then raise exception 'claim generation exhausted' using errcode='PT409'; end if;
  end if;
  perform internal.assert_evidence_claim(c,actor,c.claim_generation::text,c.claim_nonce);
  select coalesce(jsonb_agg(jsonb_build_object('identity_fact_id',f.id,'submission_id',f.submission_id,
    'reviewed_at',f.reviewed_at,'identity_is_current',f.revoked_at is null) order by f.reviewed_at desc,f.id desc),'[]'::jsonb)
    into items from (select x.* from private.accepted_identity_facts x where x.owner_id=p_owner
      and (p_before_time is null or (x.reviewed_at,x.id)<(p_before_time,p_before_id))
      order by x.reviewed_at desc,x.id desc limit 21) f;
  more:=jsonb_array_length(items)>20;
  if more then items:=items-20; end if;
  select coalesce(array_agg(distinct artifact),'{}'::uuid[]) into ids
    from private.accepted_identity_facts f join private.verification_identity_submissions s on s.id=f.submission_id
    cross join lateral unnest(array[s.id_artifact_id,s.selfie_artifact_id]) artifact
    where f.owner_id=p_owner and f.id in(select (j->>'identity_fact_id')::uuid from jsonb_array_elements(items) j);
  select coalesce(array_agg((j->>'identity_fact_id')::uuid),'{}'::uuid[]) into fact_ids from jsonb_array_elements(items) j;
  insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids,identity_fact_ids)
    values(actor,c.id,'identity_enforcement_review',c.version,c.claim_generation,ids,fact_ids);
  actor:=internal.staff_actor('decision:propose');
  perform internal.staff_actor('evidence:view');
  perform internal.staff_actor('case:claim');
  perform internal.assert_evidence_claim(c,actor,c.claim_generation::text,c.claim_nonce);
  if more then
    cursor:=jsonb_build_object('before_time',items->(jsonb_array_length(items)-1)->>'reviewed_at',
      'before_id',items->(jsonb_array_length(items)-1)->>'identity_fact_id');
  end if;
  return jsonb_build_object('case_id',c.id,'case_version',c.version,'claim_generation',c.claim_generation::text,
    'claim_nonce',c.claim_nonce,'claim_expires_at',c.claim_expires_at,'identities',items,'next_cursor',cursor);
end;
$$;
revoke all on function internal.staff_identity_history(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.staff_identity_history(uuid,timestamptz,uuid) to authenticated;
create function api.staff_identity_history(p_owner uuid,p_before_time timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.staff_identity_history(p_owner,p_before_time,p_before_id);
$$;
revoke all on function api.staff_identity_history(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function api.staff_identity_history(uuid,timestamptz,uuid) to authenticated;

-- Source: docs/backend-foundation/prototypes/public-price-negotiable.sql
-- DEC16 public advertising contract: preserve Negotiable on amount/request
-- listings. No new filter, index, role/table grant or publication authority.
-- Non-listings, Free and jobs use false; canonical listing detail is the writer.
alter table private.post_search_documents add column price_negotiable boolean not null default false;
alter table private.post_search_documents add constraint post_search_negotiable_terms
  check (not price_negotiable or (kind='listing' and category_key<>'jobs_services'
    and coalesce(price_mode in('amount','on_request'),false)));
-- Replaying an append-only local upgrade also refreshes existing synthetic rows.
update private.post_search_documents p set price_negotiable=d.price_negotiable
from private.listing_details d where d.post_id=p.post_id and p.kind='listing';

create or replace function internal.write_post_projection(p_post_id uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare post private.posts; price record; public_facets jsonb := '{}'::jsonb;
begin
  select * into post from private.posts p where p.id = p_post_id;
  select d.price_mode, d.price_cents, d.price_negotiable into price from private.listing_details d where d.post_id = post.id;
  if post.kind = 'listing' then
    select coalesce(jsonb_object_agg(f.key, d.attributes->f.key), '{}'::jsonb) into public_facets
    from private.category_fields f join private.listing_details d on d.post_id = post.id
    where f.category_key = post.category_key and f.facet_kind is not null and d.attributes ? f.key;
  end if;
  insert into private.post_search_documents (post_id, kind, area, category_key, activity_key, province_id, city_id,
    locality_label, title, summary, price_mode, price_cents, price_negotiable, published_at, visible_until, is_visible, facets)
  values (post.id, post.kind, post.area, post.category_key, post.activity_key, post.province_id, post.city_id,
    coalesce(post.locality_label, (select c.label from private.cities c where c.id = post.city_id)),
    post.title, left(coalesce(post.description, ''), 300), price.price_mode,
    case when price.price_mode = 'on_request' then null else price.price_cents end,
    coalesce(price.price_negotiable,false),
    post.published_at, post.visible_until, post.status = 'live', public_facets)
  on conflict (post_id) do update set kind = excluded.kind, area = excluded.area,
    category_key = excluded.category_key, activity_key = excluded.activity_key, province_id = excluded.province_id,
    city_id = excluded.city_id, locality_label = excluded.locality_label, title = excluded.title,
    summary = excluded.summary, price_mode = excluded.price_mode, price_cents = excluded.price_cents, price_negotiable = excluded.price_negotiable,
    published_at = excluded.published_at, visible_until = excluded.visible_until, is_visible = excluded.is_visible,
    facets = excluded.facets;
end;
$$;

create or replace function internal.search_posts(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare
  req jsonb := coalesce(p_request, '{}');
  allowed text[] := array['q', 'sort', 'area', 'category', 'activity', 'province', 'city', 'price_mode',
    'min_price_cents', 'max_price_cents', 'condition', 'attributes', 'cursor', 'limit'];
  v_sort text;
  v_asof timestamptz := statement_timestamp();
  v_after_score numeric;
  v_limit integer := 24;
  v_q text;
  v_terms text[];
  v_tsquery tsquery;
  v_area text;
  v_category text;
  v_activity text;
  v_province text;
  v_city text;
  v_price_mode text;
  v_condition text;
  v_min bigint;
  v_max bigint;
  v_attrs jsonb := '{}';
  v_contains jsonb := '{}';
  v_ranges jsonb := '[]';
  v_signature text;
  v_cursor jsonb;
  v_after_at timestamptz;
  v_after_id uuid;
  f record;
  attr record;
  v_items jsonb;
  v_total bigint;
  v_facets jsonb;
  v_has_more boolean;
begin
  if jsonb_typeof(req) <> 'object' or octet_length(req::text) > 4096 then
    raise exception 'invalid search request' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(req) k where k <> all (allowed)) then
    raise exception 'unknown search filter' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(req) e where e.key not in ('attributes', 'limit', 'min_price_cents', 'max_price_cents')
      and jsonb_typeof(e.value) <> 'string') then
    raise exception 'search filters must be strings' using errcode = '22023';
  end if;

  if req ? 'limit' then
    if jsonb_typeof(req->'limit') <> 'number' or (req->>'limit') !~ '^[0-9]{1,2}$'
      or (req->>'limit')::integer not between 1 and 48 then
      raise exception 'limit must be 1 to 48' using errcode = '22023';
    end if;
    v_limit := (req->>'limit')::integer;
  end if;

  if req ? 'q' then
    v_q := lower(normalize(req->>'q', NFKC));
    if length(v_q) > 200 then raise exception 'query too long' using errcode = '22023'; end if;
    select array_agg(m[1]) into v_terms from regexp_matches(v_q, '([[:alnum:]]+)', 'g') m;
    if coalesce(cardinality(v_terms), 0) > 8 or exists (select 1 from unnest(v_terms) t where length(t) > 40) then
      raise exception 'too many or too long search terms' using errcode = '22023';
    end if;
    if coalesce(cardinality(v_terms), 0) > 0 then
      -- Any-term query used only for ranking; matching requires every term.
      v_tsquery := to_tsquery('simple', array_to_string(array(select t || ':*' from unnest(v_terms) t), ' | '));
    else
      v_terms := null;
    end if;
  end if;
  v_sort := coalesce(req->>'sort', case when v_terms is null then 'newest' else 'relevance' end);
  if v_sort not in ('relevance', 'newest') or (v_sort = 'relevance' and v_terms is null) then
    raise exception 'sort must be relevance (with a query) or newest' using errcode = '22023';
  end if;

  v_area := req->>'area';
  if v_area is not null and v_area not in ('market', 'business', 'tourism_events') then
    raise exception 'unknown area' using errcode = '22023';
  end if;
  v_category := req->>'category';
  if v_category is not null and not exists (select 1 from private.categories c where c.key = v_category
      and (v_area is null or c.area = v_area)) then
    raise exception 'unknown category for this area' using errcode = '22023';
  end if;
  v_activity := req->>'activity';
  if v_activity is not null and (v_category is null or not exists (select 1 from private.category_activities a
      where a.category_key = v_category and a.key = v_activity)) then
    raise exception 'activity requires its category' using errcode = '22023';
  end if;
  v_province := req->>'province';
  if v_province is not null and not exists (select 1 from private.provinces p where p.id = v_province) then
    raise exception 'unknown province' using errcode = '22023';
  end if;
  v_city := req->>'city';
  if v_city is not null and (v_province is null or not exists (select 1 from private.cities c
      where c.id = v_city and c.province_id = v_province)) then
    raise exception 'city requires its province' using errcode = '22023';
  end if;
  v_price_mode := req->>'price_mode';
  v_condition := req->>'condition';
  if v_condition is not null and v_condition not in ('new','like_new','good','fair','for_parts') then
    raise exception 'unknown listing condition' using errcode='22023';
  end if;
  if v_price_mode is not null and v_price_mode not in ('amount', 'free', 'on_request') then
    raise exception 'unknown price mode' using errcode = '22023';
  end if;
  for f in select k, req->k as v from unnest(array['min_price_cents', 'max_price_cents']) k where req ? k loop
    if jsonb_typeof(f.v) <> 'number' or (f.v #>> '{}') !~ '^[0-9]{1,12}$' then
      raise exception 'price bounds must be whole cents' using errcode = '22023';
    end if;
  end loop;
  v_min := (req->>'min_price_cents')::bigint;
  v_max := (req->>'max_price_cents')::bigint;
  if (v_min is not null or v_max is not null) then
    if v_price_mode is distinct from 'amount' then
      raise exception 'price ranges apply to amount prices only' using errcode = '22023';
    end if;
    if v_min > v_max then raise exception 'minimum exceeds maximum' using errcode = '22023'; end if;
  end if;

  if req ? 'attributes' then
    v_attrs := req->'attributes';
    if jsonb_typeof(v_attrs) <> 'object' then raise exception 'attributes must be an object' using errcode = '22023'; end if;
    if v_attrs <> '{}' and v_category is null then
      raise exception 'attribute filters require a category' using errcode = '22023';
    end if;
    if v_condition is not null and v_attrs ? 'condition'
      and v_attrs->>'condition' is distinct from v_condition then
      raise exception 'conflicting condition filters' using errcode='22023';
    end if;
    for attr in select e.key, e.value from jsonb_each(v_attrs) e loop
      select cf.* into f from private.category_fields cf
        where cf.category_key = v_category and cf.key = attr.key and cf.facet_kind is not null;
      if not found then raise exception 'unknown attribute filter' using errcode = '22023'; end if;
      if f.facet_kind = 'boolean' then
        if jsonb_typeof(attr.value) <> 'boolean' then raise exception 'boolean filter expected' using errcode = '22023'; end if;
        v_contains := v_contains || jsonb_build_object(attr.key, attr.value);
      elsif f.facet_kind in ('choice', 'contains') then
        if jsonb_typeof(attr.value) <> 'string' or not coalesce(f.validation->'enum' ? (attr.value #>> '{}')
            or f.validation->'items'->'enum' ? (attr.value #>> '{}'), false) then
          raise exception 'unknown attribute choice' using errcode = '22023';
        end if;
        v_contains := v_contains || jsonb_build_object(attr.key,
          case when f.facet_kind = 'contains' then jsonb_build_array(attr.value) else attr.value end);
      else
        if jsonb_typeof(attr.value) <> 'object' or exists (select 1 from jsonb_object_keys(attr.value) k where k not in ('min', 'max'))
          or exists (select 1 from jsonb_each(attr.value) b where jsonb_typeof(b.value) <> 'number')
          or (attr.value->>'min')::numeric > (attr.value->>'max')::numeric then
          raise exception 'range filter expected' using errcode = '22023';
        end if;
        v_ranges := v_ranges || jsonb_build_array(jsonb_build_object('key', attr.key,
          'min', attr.value->'min', 'max', attr.value->'max'));
      end if;
    end loop;
  end if;

  -- The cursor is bound to every filter so a page can never continue a different query.
  v_signature := md5((req - 'cursor' - 'limit')::text);
  if req ? 'cursor' then
    begin
      v_cursor := convert_from(decode(translate(req->>'cursor', '-_', '+/'), 'base64'), 'UTF8')::jsonb;
      v_after_at := (v_cursor->>'at')::timestamptz;
      v_after_id := (v_cursor->>'id')::uuid;
      v_asof := (v_cursor->>'asof')::timestamptz;
      v_after_score := (v_cursor->>'score')::numeric;
    exception when others then
      raise exception 'invalid cursor' using errcode = '22023';
    end;
    if v_cursor->>'sig' is distinct from v_signature or v_cursor->>'sort' is distinct from v_sort
      or v_after_at is null or v_after_id is null or v_asof is null
      or (v_sort = 'relevance' and v_after_score is null) then
      raise exception 'cursor does not match this search' using errcode = '22023';
    end if;
  end if;

  with matches as (
    select d.*,
      case when v_sort = 'relevance' then round((
        0.75 * (ts_rank(d.document, v_tsquery, 32)
          + coalesce((select avg(extensions.word_similarity(t, d.search_text)) from unnest(v_terms) t), 0)) / 2
        + 0.25 / (1 + greatest(extract(epoch from (v_asof - d.published_at)), 0) / 2592000.0)
      )::numeric, 6) end as score
    from private.post_search_documents d
    where d.is_visible
      and exists(select 1 from private.public_eligible_posts eligible where eligible.id=d.post_id)
      and d.published_at <= v_asof
      and (d.visible_until is null or d.visible_until > statement_timestamp())
      and (v_terms is null or not exists (
        select 1 from unnest(v_terms) t
        where not (d.document @@ to_tsquery('simple', t || ':*')
          or (length(t) >= 4 and extensions.word_similarity(t, d.search_text) >= 0.5))))
      and (v_area is null or d.area = v_area)
      and (v_activity is null or d.activity_key = v_activity)
      and (v_province is null or d.province_id = v_province)
      and (v_city is null or d.city_id = v_city)
      and (v_price_mode is null or d.price_mode = v_price_mode)
      and (v_condition is null or (d.kind='listing' and d.facets->>'condition'=v_condition))
      and (v_min is null or d.price_cents >= v_min)
      and (v_max is null or d.price_cents <= v_max)
      and (v_contains = '{}' or d.facets @> v_contains)
      and not exists (
        select 1 from jsonb_array_elements(v_ranges) r
        where not (jsonb_typeof(d.facets->(r->>'key')) = 'number'
          and (r->'min' is null or (d.facets->>(r->>'key'))::numeric >= (r->>'min')::numeric)
          and (r->'max' is null or (d.facets->>(r->>'key'))::numeric <= (r->>'max')::numeric))
      )
  ),
  scoped as (
    select * from matches m where v_category is null or m.category_key = v_category
  ),
  page as (
    select * from scoped s
    where v_after_at is null
      or (v_sort = 'newest' and (s.published_at, s.post_id) < (v_after_at, v_after_id))
      or (v_sort = 'relevance' and (s.score, s.published_at, s.post_id) < (v_after_score, v_after_at, v_after_id))
    order by case when v_sort = 'relevance' then s.score end desc nulls last, s.published_at desc, s.post_id desc
    limit v_limit + 1
  )
  select
    (select jsonb_object_agg(x.category_key, x.n)
      from (select m.category_key, count(*) n from matches m group by m.category_key) x),
    (select count(*) from scoped),
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.post_id, 'kind', p.kind, 'area', p.area,
        'category', p.category_key, 'activity', p.activity_key, 'title', p.title, 'summary', p.summary,
        'price_mode', p.price_mode, 'price_cents', p.price_cents::text, 'price_negotiable', p.price_negotiable, 'province', p.province_id,
        'condition', case when p.kind='listing' then p.facets->>'condition' end,
        'city', p.city_id, 'locality', p.locality_label, 'published_at', p.published_at,
        'score', p.score::text)
        order by case when v_sort = 'relevance' then p.score end desc nulls last,
          p.published_at desc, p.post_id desc), '[]') from page p),
    (select count(*) > v_limit from page)
  into v_facets, v_total, v_items, v_has_more;
  if v_has_more then
    v_items := v_items - v_limit;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'sort', v_sort,
    'total', v_total,
    'facets', jsonb_build_object('categories', coalesce(v_facets, '{}')),
    'next_cursor', case when v_has_more then
      translate(encode(convert_to(jsonb_build_object('at', v_items->(v_limit - 1)->>'published_at',
        'id', v_items->(v_limit - 1)->>'id', 'score', v_items->(v_limit - 1)->>'score',
        'sort', v_sort, 'asof', v_asof, 'sig', v_signature)::text, 'UTF8'), 'base64'), E'+/\n', '-_')
      end
  );
end;
$$;

create or replace function internal.get_public_post(p_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'area', p.area, 'category', p.category_key,
    'activity', p.activity_key, 'title', p.title, 'description', p.description, 'province', p.province_id,
    'city', p.city_id, 'locality', d.locality_label, 'price_mode', d.price_mode, 'price_cents', d.price_cents::text,
    'price_negotiable', d.price_negotiable,
    'published_at', p.published_at, 'visible_until', p.visible_until,
    'condition', case when p.kind='listing' then d.facets->>'condition' end,
    'media', coalesce((select jsonb_agg(jsonb_build_object('purpose', pm.purpose, 'position', pm.position,
        'object_key', m.object_key, 'kind', m.kind, 'width', m.width, 'height', m.height,
        'focal_x', pm.focal_x, 'focal_y', pm.focal_y) order by pm.purpose, pm.position)
      from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = p.id and m.state = 'ready'), '[]'))
  from private.posts p join private.post_search_documents d on d.post_id = p.id
  where p.id = p_id and d.is_visible and (d.visible_until is null or d.visible_until>statement_timestamp())
    and exists(select 1 from private.public_eligible_posts eligible where eligible.id=p.id);
$$;
revoke all on function internal.write_post_projection(uuid) from public;
revoke all on function internal.search_posts(jsonb) from public;
revoke all on function internal.get_public_post(uuid) from public;

-- Source: docs/backend-foundation/prototypes/owner-listing-editor.sql
-- Owner listing editor restore. Additive local prototype; not release approval.
-- One bounded snapshot replaces separate content/price/attribute/media reads.
-- This DTO grants no edit, publication, funding or document access capability.
create function internal.get_owner_listing_editor(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object(
    'id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,
    'status',p.status,'revision',p.revision,'edit_of',p.edit_of,
    'content',jsonb_build_object('title',p.title,'description',p.description,
      'province_id',p.province_id,'city_id',p.city_id,'locality_label',p.locality_label),
    'terms',jsonb_build_object('price_mode',d.price_mode,'price_cents',d.price_cents,
      'price_negotiable',d.price_negotiable),
    'attributes_version',d.attributes_version,'attributes',d.attributes,
    'media',coalesce((select jsonb_agg(jsonb_build_object(
        'object_id',m.id,'kind',m.kind,'state',m.state,
        'purpose',pm.purpose,'position',pm.position,'width',m.width,'height',m.height,
        'focal_x',pm.focal_x,'focal_y',pm.focal_y) order by pm.purpose,pm.position)
      from private.post_media pm join private.media_objects m on m.id=pm.object_id
      where pm.post_id=p.id and m.owner_id=actor),'[]'::jsonb)
  ) into result
  from private.posts p join private.listing_details d on d.post_id=p.id
  where p.id=p_post_id and p.owner_id=actor and p.kind='listing' and p.area='market'
    and p.category_key in ('property','vehicles','auto_parts','electronics','home_lifestyle',
      'jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items');
  -- Authority is current, never inferred from DTO status or editable metadata.
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_owner_listing_editor(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_owner_listing_editor(uuid) to authenticated;
create function api.get_owner_listing_editor(p_post_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_owner_listing_editor(p_post_id);
$$;
revoke all on function api.get_owner_listing_editor(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_owner_listing_editor(uuid) to authenticated;

-- Source: docs/backend-foundation/prototypes/core-activity-create.sql
-- Add activity at creation without changing legacy four-argument calls.
-- One DO statement keeps signature/grant replacement atomic and remains
-- composable inside the baseline's rollback-only proof. No CASCADE.
do $activity_migration$
begin
  drop function api.create_core_draft(text,text,text,jsonb);
  drop function internal.create_core_draft(text,text,text,jsonb);

create function internal.create_core_draft(p_kind text,p_area text,p_category_key text,p_detail jsonb,p_activity_key text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post uuid; starts timestamptz; ends timestamptz; tz text; stored_activity text;
begin
  if not exists(select 1 from private.post_category_contracts c where c.category_key=p_category_key and c.kind=p_kind and c.area=p_area) then
    raise exception 'invalid kind area category' using errcode='22023';
  end if;
  if exists(select 1 from private.categories c where c.key=p_category_key and c.activity_required)
    and p_activity_key is null then
    raise exception 'activity required for this category' using errcode='22023';
  end if;
  if p_activity_key is not null and not exists(select 1 from private.category_activities a
    where a.category_key=p_category_key and a.key=p_activity_key) then
    raise exception 'activity does not belong to this category' using errcode='22023';
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
  insert into private.posts(owner_id,kind,area,category_key,activity_key) values(actor,p_kind,p_area,p_category_key,p_activity_key) returning id,activity_key into post,stored_activity;
  if p_kind='listing' then insert into private.listing_details(post_id) values(post);
  elsif p_kind='business' then insert into private.business_details(post_id) values(post);
  else insert into private.event_details(post_id,starts_at,ends_at,timezone) values(post,starts,ends,tz); end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id',post,'kind',p_kind,'area',p_area,'category_key',p_category_key,'status','draft','revision',1)
    || case when stored_activity is not null then jsonb_build_object('activity_key',stored_activity) else '{}'::jsonb end;
end;
$$;
revoke all on function internal.create_core_draft(text,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function internal.create_core_draft(text,text,text,jsonb,text) to authenticated;
create function api.create_core_draft(p_kind text,p_area text,p_category_key text,p_detail jsonb,p_activity_key text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.create_core_draft(p_kind,p_area,p_category_key,p_detail,p_activity_key);
$$;
revoke all on function api.create_core_draft(text,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function api.create_core_draft(text,text,text,jsonb,text) to authenticated;

create or replace function internal.get_core_draft(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,'status',p.status,'revision',p.revision)
      || case when p.activity_key is not null then jsonb_build_object('activity_key',p.activity_key) else '{}'::jsonb end
    into result from private.posts p where p.id=p_id and p.owner_id=actor and p.status='draft';
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_core_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_core_draft(uuid) to authenticated;
perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$activity_migration$;

-- Source: docs/backend-foundation/prototypes/owner-business-event-editor.sql
-- Owner business/event metadata restore only; not complete form or byte access.
create function internal.get_owner_business_event_editor(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object(
    'id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,
    'activity_key',p.activity_key,'status',p.status,'revision',p.revision,'edit_of',p.edit_of,
    'content',jsonb_build_object('title',p.title,'description',p.description,
      'province_id',p.province_id,'city_id',p.city_id,'locality_label',p.locality_label),
    'event_window',case when p.kind='event' then jsonb_build_object(
      'starts_at',to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone',e.timezone) else null end,
    'media',coalesce((select jsonb_agg(jsonb_build_object(
      'object_id',m.id,'kind',m.kind,'state',m.state,'purpose',m.purpose,
      'position',m.position,'width',m.width,'height',m.height,
      'focal_x',m.focal_x,'focal_y',m.focal_y) order by m.purpose,m.position)
      from (select o.id,o.kind,o.state,pm.purpose,pm.position,o.width,o.height,pm.focal_x,pm.focal_y
        from private.post_media pm join private.media_objects o on o.id=pm.object_id
        where pm.post_id=p.id and o.owner_id=actor order by pm.purpose,pm.position limit 101) m),'[]'::jsonb)
  ) into result
  from private.posts p
  join private.categories c on (c.key,c.kind,c.area)=(p.category_key,p.kind,p.area)
  left join private.business_details b on b.post_id=p.id and p.kind='business'
  left join private.event_details e on e.post_id=p.id and p.kind='event'
  where p.id=p_post_id and p.owner_id=actor
    and ((p.kind='business' and b.post_id is not null) or (p.kind='event' and e.post_id is not null));
  -- Inspecting any lifecycle state grants no mutation or media-byte capability.
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_owner_business_event_editor(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_owner_business_event_editor(uuid) to authenticated;
create function api.get_owner_business_event_editor(p_post_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_owner_business_event_editor(p_post_id);
$$;
revoke all on function api.get_owner_business_event_editor(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_owner_business_event_editor(uuid) to authenticated;

-- Source: docs/backend-foundation/prototypes/business-event-context.sql
-- Atomic enablement: corrected event approval and owner context mutation land together.
-- Paid windows/publication time stay unchanged; event visibility follows reviewed end.
do $context_migration$
begin
create or replace function internal.apply_post_edit(p_original_id uuid, p_edit_id uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare original private.posts; edit private.posts; photo_limit integer; video_limit integer;
  detail jsonb; links jsonb; rev integer; price_only boolean;
  old_event_until timestamptz; new_event_until timestamptz;
begin
  select * into original from private.posts p where p.id = p_original_id;
  select * into edit from private.posts p where p.id = p_edit_id and p.edit_of = p_original_id;
  if original.kind='event' then
    select e.ends_at into old_event_until from private.event_details e where e.post_id=original.id;
    select e.ends_at into new_event_until from private.event_details e where e.post_id=edit.id;
    if old_event_until is null or original.visible_until is null or new_event_until is null then
      raise exception 'event window is unavailable' using errcode='PT409';
    end if;
  end if;
  if original.status not in ('live', 'paused') then
    raise exception 'the live post is no longer published' using errcode = 'PT409';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode = 'PT409';
  end if;
  price_only := internal.edit_is_price_only(original.id, edit.id);
  if price_only and internal.recent_price_change(original.id) then
    raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
  end if;
  if not price_only and internal.approved_edit_count(original.id) >= internal.edit_allowance(original.id) then
    raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
  end if;
  select f.max_photos, f.max_videos into photo_limit, video_limit
    from internal.post_funding(original.id) f where f.funded_until > statement_timestamp();
  if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
  -- Lock linked objects before reading their state, as linking and cleanup do.
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = edit.id) order by m.id for update;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = edit.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = 'PT409';
  end if;
  if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose <> 'video') > photo_limit
    or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose = 'video') > video_limit then
    raise exception 'funded media allowance changed since submission' using errcode = 'PT409';
  end if;
  if not exists(select 1 from private.current_account_access u where u.id=original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode='PT409';
  end if;
  if original.kind='event' and (old_event_until<=clock_timestamp()
    or original.visible_until<=clock_timestamp() or new_event_until<=clock_timestamp()) then
    raise exception 'original or proposed event window has ended' using errcode='PT409';
  end if;
  select coalesce(jsonb_agg(to_jsonb(pm)), '[]') into links from private.post_media pm where pm.post_id = edit.id;
  detail := case original.kind
      when 'listing' then (select to_jsonb(d) from private.listing_details d where d.post_id = edit.id)
      when 'business' then (select to_jsonb(d) from private.business_details d where d.post_id = edit.id)
      else (select to_jsonb(d) from private.event_details d where d.post_id = edit.id) end
    || jsonb_build_object('post_id', original.id);
  delete from private.posts where id = edit.id; -- with its details, links and queue claim
  update private.posts set category_key = edit.category_key, activity_key = edit.activity_key, title = edit.title,
    description = edit.description, province_id = edit.province_id, city_id = edit.city_id,
    locality_label = edit.locality_label,
    visible_until = case when original.kind='event' then new_event_until else original.visible_until end,
    revision = revision + 1, content_updated_at = statement_timestamp()
  where id = original.id returning revision into rev;
  if original.kind = 'listing' then
    delete from private.listing_details where post_id = original.id;
    insert into private.listing_details select (jsonb_populate_record(null::private.listing_details, detail)).*;
  elsif original.kind = 'business' then
    delete from private.business_details where post_id = original.id;
    insert into private.business_details select (jsonb_populate_record(null::private.business_details, detail)).*;
  else
    delete from private.event_details where post_id = original.id;
    insert into private.event_details select (jsonb_populate_record(null::private.event_details, detail)).*;
  end if;
  delete from private.post_media where post_id = original.id;
  insert into private.post_media
  select (jsonb_populate_record(null::private.post_media, l || jsonb_build_object('post_id', original.id))).*
  from jsonb_array_elements(links) l;
  perform internal.write_post_projection(original.id);
  if not exists(select 1 from private.current_account_access u where u.id=original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode='PT409';
  end if;
  if original.kind='event' and (old_event_until<=clock_timestamp()
    or original.visible_until<=clock_timestamp() or new_event_until<=clock_timestamp()) then
    raise exception 'original or proposed event window has ended' using errcode='PT409';
  end if;

  return jsonb_build_object('revision', rev, 'price_only', price_only);
end;
$$;
revoke all on function internal.apply_post_edit(uuid, uuid) from public, anon, authenticated, service_role;

create function internal.save_business_event_context(p_post_id uuid,p_expected_revision integer,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post private.posts; c jsonb:=p_patch; w jsonb;
  activity text; starts timestamptz; ends timestamptz; zone text; rev integer;
begin
  -- The original precedes its copy, matching content, moderation and discard.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  if jsonb_typeof(c) is distinct from 'object' or octet_length(c::text)>1024 or c='{}'::jsonb
    or not(array(select jsonb_object_keys(c)) <@ array['activity_key','event_window']) then
    raise exception 'invalid context patch' using errcode='22023';
  end if;
  select * into post from private.posts p where p.id=p_post_id and p.owner_id=actor for update;
  if not found or post.kind not in ('business','event') then
    raise exception 'business or event not found' using errcode='22023';
  end if;
  if post.status not in ('draft','rejected','paused') then
    raise exception 'this context cannot be edited now' using errcode='22023';
  end if;
  if post.revision<>p_expected_revision then raise exception 'post changed' using errcode='PT409'; end if;
  activity:=post.activity_key;
  if c ? 'activity_key' then
    if jsonb_typeof(c->'activity_key') not in ('string','null')
      or (c->>'activity_key' is not null and (c->>'activity_key') !~ '^[a-z][a-z0-9_]{0,79}$') then
      raise exception 'invalid activity' using errcode='22023';
    end if;
    activity:=c->>'activity_key';
    if activity is null and exists(select 1 from private.categories k where k.key=post.category_key and k.activity_required)
      or activity is not null and not exists(select 1 from private.category_activities a where a.category_key=post.category_key and a.key=activity) then
      raise exception 'activity does not meet the category rules' using errcode='22023';
    end if;
  end if;
  if c ? 'event_window' then
    w:=c->'event_window';
    if post.kind<>'event' or jsonb_typeof(w) is distinct from 'object' or octet_length(w::text)>512
      or not(array(select jsonb_object_keys(w)) <@ array['starts_at','ends_at','timezone'])
      or jsonb_typeof(w->'starts_at') is distinct from 'string' or jsonb_typeof(w->'ends_at') is distinct from 'string'
      or jsonb_typeof(w->'timezone') is distinct from 'string'
      or (w->>'starts_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
      or (w->>'ends_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' then
      raise exception 'complete event window required' using errcode='22023';
    end if;
    begin
      starts:=(w->>'starts_at')::timestamptz; ends:=(w->>'ends_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid event instant' using errcode='22023';
    end;
    zone:=w->>'timezone';
    if not isfinite(starts) or not isfinite(ends)
      or extract(year from starts at time zone 'UTC') not between 1 and 9999
      or extract(year from ends at time zone 'UTC') not between 1 and 9999
      or starts<>date_trunc('milliseconds',starts) or ends<>date_trunc('milliseconds',ends)
      or ends<=starts or ends-starts>interval '90 days'
      or not exists(select 1 from private.post_event_timezones z where z.name=zone) then
      raise exception 'invalid event window' using errcode='22023';
    end if;
    update private.event_details set starts_at=starts,ends_at=ends,timezone=zone where post_id=post.id;
    if not found then raise exception 'event detail not found' using errcode='22023'; end if;
  end if;
  update private.posts set activity_key=activity,revision=revision+1,content_updated_at=statement_timestamp()
    where id=post.id returning revision into rev;
  perform internal.price_draft_actor();
  return jsonb_build_object('id',post.id,'revision',rev);
end;
$$;
revoke all on function internal.save_business_event_context(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.save_business_event_context(uuid,integer,jsonb) to authenticated;
create function api.save_business_event_context(p_post_id uuid,p_expected_revision integer,p_patch jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_business_event_context(p_post_id,p_expected_revision,p_patch);
$$;
revoke all on function api.save_business_event_context(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function api.save_business_event_context(uuid,integer,jsonb) to authenticated;

perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$context_migration$;

-- Source: docs/backend-foundation/prototypes/public-event-window.sql
-- Approved public event schedule; preserve eligibility and price/media projection.
do $public_event_window_migration$
begin
create or replace function internal.get_public_post(p_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'area', p.area, 'category', p.category_key,
    'activity', p.activity_key, 'title', p.title, 'description', p.description, 'province', p.province_id,
    'city', p.city_id, 'locality', d.locality_label, 'price_mode', d.price_mode, 'price_cents', d.price_cents::text,
    'price_negotiable', d.price_negotiable,
    'published_at', p.published_at, 'visible_until', p.visible_until,
    'event_window',case when p.kind='event' then jsonb_build_object(
      'starts_at',to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone',e.timezone) else null end,
    'condition', case when p.kind='listing' then d.facets->>'condition' end,
    'media', coalesce((select jsonb_agg(jsonb_build_object('purpose', pm.purpose, 'position', pm.position,
        'object_key', m.object_key, 'kind', m.kind, 'width', m.width, 'height', m.height,
        'focal_x', pm.focal_x, 'focal_y', pm.focal_y) order by pm.purpose, pm.position)
      from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = p.id and m.state = 'ready'), '[]'))
  from private.posts p join private.post_search_documents d on d.post_id = p.id
  left join private.event_details e on e.post_id=p.id and p.kind='event'
  where p.id = p_id and d.is_visible and (d.visible_until is null or d.visible_until>statement_timestamp())
    and exists(select 1 from private.public_eligible_posts eligible where eligible.id=p.id);
$$;
revoke all on function internal.get_public_post(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_public_post(uuid) to anon,authenticated;
perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$public_event_window_migration$;

-- Source: docs/backend-foundation/prototypes/event-duplicate-admission.sql
-- DEC-32: deletion restores a per-account place; corrections keep one logical identity.
-- Exact-core rejection is separate from administrator suspicion and never creates a flag.
do $event_duplicate_admission$
begin
-- Conservative exact-core duplicate protection. No inference of real-world identity.
-- Media and timezone spellings do not distinguish events; canonical UTC instants do.
create function internal.event_duplicate_text(p_value text)
returns text language sql immutable strict set search_path=pg_catalog as $$
  select btrim(regexp_replace(lower(pg_catalog.normalize(p_value,'NFC')),
    U&'[ \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'));
$$;
revoke all on function internal.event_duplicate_text(text) from public,anon,authenticated,service_role;

create function internal.event_duplicate_core(p_post_id uuid)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_array(internal.event_duplicate_text(p.title),internal.event_duplicate_text(p.description),
    p.category_key,p.activity_key,p.province_id,p.city_id,
    internal.event_duplicate_text(coalesce(p.locality_label,(select c.label from private.cities c where c.id=p.city_id))),
    to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  from private.posts p join private.event_details e on e.post_id=p.id where p.id=p_post_id and p.kind='event';
$$;
revoke all on function internal.event_duplicate_core(uuid) from public,anon,authenticated,service_role;

create function internal.assert_event_duplicate_absent(p_post_id uuid,p_staff boolean)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare target private.posts; logical_id uuid; core jsonb; duplicate boolean; actor uuid;
begin
  if p_staff then actor:=internal.staff_actor('post:moderate');
  else actor:=internal.price_draft_actor(); end if;
  if p_staff is null then raise exception 'invalid internal authority context' using errcode='22023'; end if;
  -- Callers already hold original -> copy -> media locks. Never lock competitors.
  select * into target from private.posts p where p.id=p_post_id;
  if target.id is null or target.kind<>'event' then raise exception 'event not found' using errcode='22023'; end if;
  if (not p_staff and actor<>target.owner_id) or (p_staff and actor=target.owner_id) then
    raise exception 'event authority denied' using errcode='42501';
  end if;
  logical_id:=coalesce(target.edit_of,target.id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target.owner_id::text,909));
  -- Recheck before data-dependent denials, not only on the successful return path.
  if p_staff then perform internal.staff_actor('post:moderate');
  else perform internal.price_draft_actor(); end if;
  core:=internal.event_duplicate_core(target.id);
  select exists(select 1 from private.posts p
    where p.owner_id=target.owner_id and p.kind='event' and p.status in('pending_moderation','live')
      and coalesce(p.edit_of,p.id)<>logical_id
      and (p.edit_of is null or (p.status='pending_moderation' and exists(
        select 1 from private.posts o join private.event_details e on e.post_id=o.id
        where o.id=p.edit_of and o.status='live' and o.visible_until>clock_timestamp() and e.ends_at>clock_timestamp())))
      and internal.event_duplicate_core(p.id)=core) into duplicate;
  if p_staff then perform internal.staff_actor('post:moderate');
  else perform internal.price_draft_actor(); end if;
  if core is null then raise exception 'event detail not found' using errcode='22023'; end if;
  if duplicate then
    raise exception 'a matching event is already pending or live on your account'
      using errcode='PT409',detail='duplicate_event';
  end if;
end;
$$;
revoke all on function internal.assert_event_duplicate_absent(uuid,boolean) from public,anon,authenticated,service_role;

-- Bound candidate lookup independently of a member's paid listing history.
create index posts_active_event_owner_idx on private.posts(owner_id)
  where kind='event' and status in('pending_moderation','live');

create or replace function internal.submit_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  photos integer;
  videos integer;
  photo_limit integer;
  video_limit integer;
  rev integer;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'this post cannot be submitted now' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if post.title is null then
    raise exception 'title length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 2 else 5 end,
    'maxLength',case when post.kind='event' then 120 else 100 end),to_jsonb(post.title));
  if post.kind in ('listing','event') and post.description is null then
    raise exception 'description length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 0 else 20 end,
    'maxLength',case when post.kind='business' then 3000 else 5000 end),to_jsonb(coalesce(post.description,'')));
  if post.province_id is null or (post.city_id is null and post.locality_label is null) then
    raise exception 'province and city or locality required' using errcode = '22023';
  end if;
  if post.kind='listing' then
    if not exists(select 1 from private.listing_details d where d.post_id=post.id and d.price_mode is not null) then
      raise exception 'choose an explicit listing price' using errcode='22023';
    end if;
    perform internal.validate_listing_attributes(post.category_key,d.attributes,true)
      from private.listing_details d where d.post_id=post.id;
  end if;
  select count(distinct pm.object_id) into photos from private.post_media pm
    where pm.post_id = post.id and pm.purpose in ('cover', 'gallery');
  select count(distinct pm.object_id) into videos from private.post_media pm where pm.post_id=post.id and pm.purpose='video';
  if ((post.kind='listing' and post.category_key<>'jobs_services') or (post.kind='business' and post.area='tourism_events')) and photos = 0 then
    raise exception 'at least one photo is required' using errcode = '22023';
  end if;
  if post.kind='event' and photos+videos=0 then raise exception 'at least one photo or video required' using errcode='22023'; end if;
  if photos > 0 and not exists (select 1 from private.post_media pm where pm.post_id = post.id and pm.purpose = 'cover') then
    raise exception 'choose a cover photo' using errcode = '22023';
  end if;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = post.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = '22023';
  end if;
  if post.edit_of is not null then
    -- A live edit uses the live post's funding: no new activation or fair use.
    if not exists (select 1 from private.posts o where o.id = post.edit_of and o.status = 'live') then
      raise exception 'the live post is no longer published' using errcode = 'PT409';
    end if;
    if internal.edit_is_price_only(post.edit_of, post.id) then
      if internal.recent_price_change(post.edit_of) then
        raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
      end if;
    elsif internal.approved_edit_count(post.edit_of) >= internal.edit_allowance(post.edit_of) then
      raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
    end if;
    select f.max_photos, f.max_videos into photo_limit, video_limit
      from internal.post_funding(post.edit_of) f where f.funded_until > statement_timestamp();
    if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode = '22023';
    end if;
  elsif post.kind = 'event' then
    -- Free events: fair use of 5 active (pending or live) and 10 submissions per 30 days.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 909));
    perform internal.price_draft_actor(); -- fresh authority before quota or duplicate errors
    if (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.status in ('pending_moderation', 'live') and p.id <> post.id) >= 5
      or (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.submitted_at > statement_timestamp() - interval '30 days' and p.id <> post.id) >= 10 then
      raise exception 'event fair-use limit reached' using errcode = 'PT429';
    end if;
  else
    perform internal.activate_post(post.id);
    select e.max_photos,e.max_videos into photo_limit,video_limit
      from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
      where a.post_id=post.id and a.released_at is null;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode='22023';
    end if;
  end if;
  if post.kind='event' then
    perform internal.assert_event_duplicate_absent(post.id,false);
    if post.edit_of is not null and not exists(
      select 1 from internal.post_funding(post.edit_of) f where f.funded_until>clock_timestamp()) then
      raise exception 'funding or event window has ended' using errcode='PT409';
    end if;
  end if;
  update private.posts set status = 'pending_moderation', submitted_at = statement_timestamp(),
    status_reason = null, revision = revision + 1
  where id = post.id returning revision into rev;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'pending_moderation', 'revision', rev);
end;
$$;
revoke all on function internal.submit_post(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.submit_post(uuid,integer) to authenticated;

create or replace function internal.apply_post_edit(p_original_id uuid, p_edit_id uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare original private.posts; edit private.posts; photo_limit integer; video_limit integer;
  detail jsonb; links jsonb; rev integer; price_only boolean;
  old_event_until timestamptz; new_event_until timestamptz;
begin
  select * into original from private.posts p where p.id = p_original_id;
  select * into edit from private.posts p where p.id = p_edit_id and p.edit_of = p_original_id;
  if original.kind='event' then
    select e.ends_at into old_event_until from private.event_details e where e.post_id=original.id;
    select e.ends_at into new_event_until from private.event_details e where e.post_id=edit.id;
    if old_event_until is null or original.visible_until is null or new_event_until is null then
      raise exception 'event window is unavailable' using errcode='PT409';
    end if;
  end if;
  if original.status not in ('live', 'paused') then
    raise exception 'the live post is no longer published' using errcode = 'PT409';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode = 'PT409';
  end if;
  price_only := internal.edit_is_price_only(original.id, edit.id);
  if price_only and internal.recent_price_change(original.id) then
    raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
  end if;
  if not price_only and internal.approved_edit_count(original.id) >= internal.edit_allowance(original.id) then
    raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
  end if;
  select f.max_photos, f.max_videos into photo_limit, video_limit
    from internal.post_funding(original.id) f where f.funded_until > statement_timestamp();
  if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
  -- Lock linked objects before reading their state, as linking and cleanup do.
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = edit.id) order by m.id for update;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = edit.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = 'PT409';
  end if;
  if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose <> 'video') > photo_limit
    or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose = 'video') > video_limit then
    raise exception 'funded media allowance changed since submission' using errcode = 'PT409';
  end if;
  if original.kind='event' and original.status='live' then
    perform internal.assert_event_duplicate_absent(edit.id,true);
  end if;
  if not exists(select 1 from private.current_account_access u where u.id=original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode='PT409';
  end if;
  if original.kind='event' and (old_event_until<=clock_timestamp()
    or original.visible_until<=clock_timestamp() or new_event_until<=clock_timestamp()) then
    raise exception 'original or proposed event window has ended' using errcode='PT409';
  end if;
  select coalesce(jsonb_agg(to_jsonb(pm)), '[]') into links from private.post_media pm where pm.post_id = edit.id;
  detail := case original.kind
      when 'listing' then (select to_jsonb(d) from private.listing_details d where d.post_id = edit.id)
      when 'business' then (select to_jsonb(d) from private.business_details d where d.post_id = edit.id)
      else (select to_jsonb(d) from private.event_details d where d.post_id = edit.id) end
    || jsonb_build_object('post_id', original.id);
  delete from private.posts where id = edit.id; -- with its details, links and queue claim
  update private.posts set category_key = edit.category_key, activity_key = edit.activity_key, title = edit.title,
    description = edit.description, province_id = edit.province_id, city_id = edit.city_id,
    locality_label = edit.locality_label,
    visible_until = case when original.kind='event' then new_event_until else original.visible_until end,
    revision = revision + 1, content_updated_at = statement_timestamp()
  where id = original.id returning revision into rev;
  if original.kind = 'listing' then
    delete from private.listing_details where post_id = original.id;
    insert into private.listing_details select (jsonb_populate_record(null::private.listing_details, detail)).*;
  elsif original.kind = 'business' then
    delete from private.business_details where post_id = original.id;
    insert into private.business_details select (jsonb_populate_record(null::private.business_details, detail)).*;
  else
    delete from private.event_details where post_id = original.id;
    insert into private.event_details select (jsonb_populate_record(null::private.event_details, detail)).*;
  end if;
  delete from private.post_media where post_id = original.id;
  insert into private.post_media
  select (jsonb_populate_record(null::private.post_media, l || jsonb_build_object('post_id', original.id))).*
  from jsonb_array_elements(links) l;
  perform internal.write_post_projection(original.id);
  if not exists(select 1 from private.current_account_access u where u.id=original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode='PT409';
  end if;
  if original.kind='event' and (old_event_until<=clock_timestamp()
    or original.visible_until<=clock_timestamp() or new_event_until<=clock_timestamp()) then
    raise exception 'original or proposed event window has ended' using errcode='PT409';
  end if;

  return jsonb_build_object('revision', rev, 'price_only', price_only);
end;
$$;
revoke all on function internal.apply_post_edit(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function internal.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_reason text,
  p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.staff_actor('post:moderate');
  post private.posts;
  original_id uuid;
  funded_until timestamptz;
  photo_limit integer;
  video_limit integer;
  rev integer;
  merged jsonb;
begin
  perform internal.assert_post_revision(p_expected_revision);
  if p_decision is null or p_decision not in ('approve', 'reject')
    or (p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) not between 5 and 500) then
    raise exception 'decision and, for rejections, a reason are required' using errcode = '22023';
  end if;
  -- An edit locks its live post before the copy, like every owner command.
  select p.edit_of into original_id from private.posts p where p.id = p_post_id;
  if original_id is not null then
    perform 1 from private.posts p where p.id = original_id for update;
  end if;
  select * into post from private.posts p where p.id = p_post_id for update;
  if not found or post.status <> 'pending_moderation' or post.edit_of is distinct from original_id then
    raise exception 'post is not awaiting moderation' using errcode = '22023';
  end if;
  actor := internal.staff_actor('post:moderate'); -- authority after any lock wait
  if post.owner_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  perform internal.consume_queue_claim('post', post.id, actor, p_claim_generation, p_claim_nonce);
  if post.revision <> p_expected_revision then raise exception 'post changed since review' using errcode = 'PT409'; end if;
  if p_decision = 'reject' then
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'moderation'
      where post_id = post.id and released_at is null;
    update private.posts set status = 'rejected', status_reason = btrim(p_reason), revision = revision + 1
      where id = post.id;
  elsif original_id is not null then
    merged := internal.apply_post_edit(original_id, post.id);
    rev := (merged->>'revision')::integer;
  else
    if post.kind='event' then perform internal.assert_event_duplicate_absent(post.id,true); end if;
    if not exists(select 1 from private.current_account_access u where u.id=post.owner_id) then
      raise exception 'post owner is no longer eligible' using errcode='PT409';
    end if;
    select f.funded_until, f.max_photos, f.max_videos into funded_until, photo_limit, video_limit
      from internal.post_funding(post.id) f;
    if funded_until is null or funded_until <= (case when post.kind='event' then clock_timestamp() else statement_timestamp() end) then
      raise exception 'funding or event window has ended' using errcode = 'PT409';
    end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose='video')>video_limit then
      raise exception 'funded media allowance changed since submission' using errcode='PT409';
    end if;
    update private.posts set status = 'live', published_at = statement_timestamp(), visible_until = funded_until,
      revision = revision + 1 where id = post.id;
    perform internal.write_post_projection(post.id);
    if post.kind='event' and (funded_until<=clock_timestamp() or not exists(
      select 1 from private.current_account_access u where u.id=post.owner_id)) then
      raise exception 'event window or owner is no longer eligible' using errcode='PT409';
    end if;

  end if;
  perform internal.staff_actor('post:moderate'); -- authority after claim-row and media waits
  insert into private.moderation_log (post_id, edit_id, staff_id, decision, post_revision, reason, price_only)
  values (coalesce(original_id, post.id), case when original_id is not null then post.id end, actor, p_decision,
    p_expected_revision, nullif(btrim(coalesce(p_reason, '')), ''), coalesce((merged->>'price_only')::boolean, false));
  if original_id is not null then
    return jsonb_build_object('id', post.id, 'edit_of', original_id,
      'status', case when p_decision = 'approve' then 'merged' else 'rejected' end, 'post_revision', rev,
      'price_only', coalesce((merged->>'price_only')::boolean, false));
  end if;
  return jsonb_build_object('id', post.id, 'status', case when p_decision = 'approve' then 'live' else 'rejected' end,
    'visible_until', funded_until);
end;
$$;
revoke all on function internal.moderate_post(uuid,integer,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.moderate_post(uuid,integer,text,text,text,uuid) to authenticated;
perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$event_duplicate_admission$;

-- Source: docs/backend-foundation/prototypes/staff-event-duplicate-flags.sql
-- LOCAL CANDIDATE. Not released or applied to a hosted schema.
-- DEC-32: administrator suspicion is separate from exact-core admission and enforcement.
do $staff_event_duplicate_flags$
begin
insert into private.staff_capabilities(role,capability,requires_recent_mfa)
values('admin','event:flag_duplicate',true);

alter table private.reports
  add column report_origin text not null default 'public',
  add column duplicate_post_a uuid,
  add column duplicate_post_b uuid,
  add column duplicate_revision_a integer,
  add column duplicate_revision_b integer,
  add column duplicate_owner_b uuid,
  add column duplicate_created_by uuid;
alter table private.reports alter column reporter_ip_hmac drop not null;
alter table private.reports drop constraint reports_category_check;
alter table private.reports add constraint reports_category_check check(
  category in('scam','prohibited_item','impersonation','harassment','misleading_info','duplicate_event'));
alter table private.reports add constraint reports_origin_shape check(
  (report_origin='public' and category in('scam','prohibited_item','impersonation','harassment','misleading_info')
    and reporter_ip_hmac is not null
    and num_nonnulls(duplicate_post_a,duplicate_post_b,duplicate_revision_a,duplicate_revision_b,
      duplicate_owner_b,duplicate_created_by)=0)
  or
  (report_origin='staff' and category='duplicate_event' and reporter_ip_hmac is null
    and (reporter_id is null or reporter_id=duplicate_created_by)
    and num_nonnulls(duplicate_post_a,duplicate_post_b,duplicate_revision_a,duplicate_revision_b,
      duplicate_owner_b,duplicate_created_by)=6
    and duplicate_post_a<duplicate_post_b
    and duplicate_revision_a>0 and duplicate_revision_b>0
    and (post_id is null or post_id=duplicate_post_a)));
drop index private.reports_one_open_signed_in_idx;
drop index private.reports_one_open_anonymous_idx;
create unique index reports_one_open_signed_in_idx on private.reports(post_id,reporter_id)
  where report_origin='public' and status='open' and reporter_id is not null;
create unique index reports_one_open_anonymous_idx on private.reports(post_id,reporter_ip_hmac)
  where report_origin='public' and status='open' and reporter_id is null;
create unique index reports_one_open_duplicate_pair_idx on private.reports(duplicate_post_a,duplicate_post_b)
  where report_origin='staff' and status='open';
-- Plain UUID snapshots intentionally survive post deletion without adding a
-- related-account FK that would prevent that unrelated account's removal.

create function internal.report_identity_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.report_origin,new.subject_account_id,new.category,new.severity,new.description,
      new.reporter_ip_hmac,new.created_at,new.duplicate_post_a,new.duplicate_post_b,
      new.duplicate_revision_a,new.duplicate_revision_b,new.duplicate_owner_b,new.duplicate_created_by)
    is distinct from
    (old.id,old.report_origin,old.subject_account_id,old.category,old.severity,old.description,
      old.reporter_ip_hmac,old.created_at,old.duplicate_post_a,old.duplicate_post_b,
      old.duplicate_revision_a,old.duplicate_revision_b,old.duplicate_owner_b,old.duplicate_created_by)
    or (new.post_id is distinct from old.post_id and new.post_id is not null)
    or (new.reporter_id is distinct from old.reporter_id and new.reporter_id is not null) then
    raise exception 'report identity and original statement are immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.report_identity_guard() from public,anon,authenticated,service_role;
create trigger reports_identity before update on private.reports
  for each row execute function internal.report_identity_guard();

create function internal.lock_duplicate_event_pair(p_a uuid,p_b uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_a is null or p_b is null or p_a>=p_b then
    raise exception 'choose two different event posts' using errcode='22023';
  end if;
  -- Preserve key-share FK checks while serializing actual content/state/deletion.
  perform p.id from private.posts p where p.id in(p_a,p_b) order by p.id for no key update;
end;
$$;
revoke all on function internal.lock_duplicate_event_pair(uuid,uuid) from public,anon,authenticated,service_role;

create function internal.duplicate_public_event_view(p_id uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select jsonb_build_object('id',p.id,'revision',p.revision,'title',p.title,
    'description',p.description,'category',p.category_key,'activity',p.activity_key,
    'province',p.province_id,'city',p.city_id,
    'locality',coalesce(p.locality_label,(select c.label from private.cities c where c.id=p.city_id)),
    'event_window',jsonb_build_object(
      'starts_at',to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone',e.timezone))
  from private.posts p join private.event_details e on e.post_id=p.id
  where p.id=p_id and p.kind='event' and p.edit_of is null
    and p.visible_until>clock_timestamp() and e.ends_at>clock_timestamp()
    and exists(select 1 from private.public_eligible_posts eligible where eligible.id=p.id);
$$;
revoke all on function internal.duplicate_public_event_view(uuid) from public,anon,authenticated,service_role;

create function internal.preview_duplicate_events(p_post_a uuid,p_post_b uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('event:flag_duplicate'); a uuid; b uuid;
  view_a jsonb; view_b jsonb; flag uuid;
begin
  if p_post_a is null or p_post_b is null or p_post_a=p_post_b then
    raise exception 'choose two different event posts' using errcode='22023';
  end if;
  a:=least(p_post_a,p_post_b); b:=greatest(p_post_a,p_post_b);
  perform internal.lock_duplicate_event_pair(a,b);
  actor:=internal.staff_actor('event:flag_duplicate');
  view_a:=internal.duplicate_public_event_view(a);
  view_b:=internal.duplicate_public_event_view(b);
  perform internal.staff_actor('event:flag_duplicate');
  if view_a is null or view_b is null then
    raise exception 'event pair is unavailable' using errcode='22023';
  end if;
  if exists(select 1 from private.posts p where p.id in(a,b) and p.owner_id=actor) then
    raise exception 'you cannot flag your own event' using errcode='42501';
  end if;
  select r.id into flag from private.reports r where r.report_origin='staff'
    and r.status='open' and r.duplicate_post_a=a and r.duplicate_post_b=b;
  perform internal.staff_actor('event:flag_duplicate');
  return jsonb_build_object('post_a',view_a,'post_b',view_b,'open_flag_id',flag);
end;
$$;
revoke all on function internal.preview_duplicate_events(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.preview_duplicate_events(uuid,uuid) to authenticated;
create function api.preview_duplicate_events(p_post_a uuid,p_post_b uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.preview_duplicate_events(p_post_a,p_post_b);
$$;
revoke all on function api.preview_duplicate_events(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function api.preview_duplicate_events(uuid,uuid) to authenticated;

create function internal.flag_duplicate_events(p_post_a uuid,p_expected_revision_a integer,
  p_post_b uuid,p_expected_revision_b integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('event:flag_duplicate'); a uuid; b uuid;
  revision_a integer; revision_b integer; post_a private.posts; post_b private.posts;
  view_a jsonb; view_b jsonb; flag uuid; reason text;
begin
  if p_post_a is null or p_post_b is null or p_post_a=p_post_b then
    raise exception 'choose two different event posts' using errcode='22023';
  end if;
  if p_expected_revision_a is null or p_expected_revision_b is null
    or p_expected_revision_a<1 or p_expected_revision_b<1 then
    raise exception 'positive expected revisions required' using errcode='22023';
  end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":2000}'::jsonb,
    to_jsonb(p_reason)) #>> '{}';
  if reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode='22023';
  end if;
  a:=least(p_post_a,p_post_b); b:=greatest(p_post_a,p_post_b);
  revision_a:=case when a=p_post_a then p_expected_revision_a else p_expected_revision_b end;
  revision_b:=case when b=p_post_b then p_expected_revision_b else p_expected_revision_a end;
  perform internal.lock_duplicate_event_pair(a,b);
  actor:=internal.staff_actor('event:flag_duplicate');
  select * into post_a from private.posts p where p.id=a;
  select * into post_b from private.posts p where p.id=b;
  view_a:=internal.duplicate_public_event_view(a);
  view_b:=internal.duplicate_public_event_view(b);
  perform internal.staff_actor('event:flag_duplicate');
  if view_a is null or view_b is null then
    raise exception 'event pair is unavailable' using errcode='22023';
  end if;
  if post_a.owner_id=actor or post_b.owner_id=actor then
    raise exception 'you cannot flag your own event' using errcode='42501';
  end if;
  if post_a.revision<>revision_a or post_b.revision<>revision_b then
    raise exception 'event pair changed since review' using errcode='PT409',detail='event_pair_changed';
  end if;
  select r.id into flag from private.reports r where r.report_origin='staff'
    and r.status='open' and r.duplicate_post_a=a and r.duplicate_post_b=b;
  perform internal.staff_actor('event:flag_duplicate');
  if flag is not null then return jsonb_build_object('id',flag,'status','open','reused',true,'post_a',a,'post_b',b); end if;
  insert into private.reports(post_id,subject_account_id,category,description,reporter_id,reporter_ip_hmac,
    report_origin,duplicate_post_a,duplicate_post_b,duplicate_revision_a,duplicate_revision_b,
    duplicate_owner_b,duplicate_created_by)
  values(a,post_a.owner_id,'duplicate_event',reason,actor,null,'staff',a,b,revision_a,revision_b,post_b.owner_id,actor)
  returning id into flag;
  perform internal.staff_actor('event:flag_duplicate');
  view_a:=internal.duplicate_public_event_view(a);
  view_b:=internal.duplicate_public_event_view(b);
  perform internal.staff_actor('event:flag_duplicate');
  if view_a is null or view_b is null then
    raise exception 'event pair changed since review' using errcode='PT409',detail='event_pair_changed';
  end if;
  return jsonb_build_object('id',flag,'status','open','reused',false,'post_a',a,'post_b',b);
end;
$$;
revoke all on function internal.flag_duplicate_events(uuid,integer,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.flag_duplicate_events(uuid,integer,uuid,integer,text) to authenticated;
create function api.flag_duplicate_events(p_post_a uuid,p_expected_revision_a integer,
  p_post_b uuid,p_expected_revision_b integer,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.flag_duplicate_events(p_post_a,p_expected_revision_a,p_post_b,p_expected_revision_b,p_reason);
$$;
revoke all on function api.flag_duplicate_events(uuid,integer,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function api.flag_duplicate_events(uuid,integer,uuid,integer,text) to authenticated;

create or replace function internal.queue_conflict(p_actor uuid,p_post_id uuid,p_report_id uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select case when p_post_id is not null
    then exists(select 1 from private.posts p where p.id=p_post_id and p.owner_id=p_actor)
    else exists(select 1 from private.reports r where r.id=p_report_id and
      (r.reporter_id=p_actor or r.subject_account_id=p_actor
       or r.duplicate_owner_b=p_actor or r.duplicate_created_by=p_actor))
  end;
$$;
revoke all on function internal.queue_conflict(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function internal.claim_queue_items(p_queue text, p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:claim'); allowed integer; r record;
  c private.queue_claims; items jsonb := '[]'::jsonb;
begin
  if p_queue is null or p_queue not in ('content', 'reports') then
    raise exception 'unknown queue' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'claim between 1 and 25 items' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 1201));
  actor := internal.staff_actor('queue:claim'); -- authority after the holder guard wait
  allowed := least(p_limit, 20 - (select count(*) from private.queue_claims q
    where q.claimed_by = actor and q.claim_expires_at > clock_timestamp())::integer);
  if allowed <= 0 then return items; end if;
  -- Scan with headroom: a row another claimer committed after this scan began
  -- is skipped by take_queue_claim, and the next row takes its place.
  if p_queue = 'content' then
    for r in
      select p.id from private.posts p
      where p.status = 'pending_moderation' and p.owner_id <> actor
        and not exists (select 1 from private.queue_claims q where q.post_id = p.id
          and q.claimed_by is not null and q.claim_expires_at > clock_timestamp())
      order by p.submitted_at, p.id limit allowed * 2
      for update of p skip locked
    loop
      c := internal.take_queue_claim(actor, r.id, null);
      if c.id is not null then items := items || jsonb_build_array(internal.queue_claim_view(c)); end if;
      exit when jsonb_array_length(items) >= allowed;
    end loop;
  else
    for r in
      select x.id from private.reports x
      where x.status = 'open' and not internal.queue_conflict(actor,null,x.id)
        and not exists (select 1 from private.queue_claims q where q.report_id = x.id
          and q.claimed_by is not null and q.claim_expires_at > clock_timestamp())
      order by (x.severity = 'high') desc, x.created_at, x.id limit allowed * 2
      for update of x skip locked
    loop
      c := internal.take_queue_claim(actor, null, r.id);
      if c.id is not null then items := items || jsonb_build_array(internal.queue_claim_view(c)); end if;
      exit when jsonb_array_length(items) >= allowed;
    end loop;
  end if;
  perform internal.staff_actor('queue:claim'); -- authority after any claim-row wait
  return items;
end;
$$;
revoke all on function internal.claim_queue_items(text,integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_queue_items(text,integer) to authenticated;

create or replace function internal.staff_review_report(p_report_id uuid,p_claim_generation text,p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('report:resolve'); c private.queue_claims; r private.reports; result jsonb;
begin
  -- Never acquire base-post locks after holding a report: deletion takes the
  -- post first and its report FK second. Return current public data or null.
  select * into r from private.reports x where x.id=p_report_id for update;
  actor:=internal.staff_actor('report:resolve');
  c:=internal.lock_queue_claim(null,r.id);
  actor:=internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor,null,p_report_id) then
    raise exception 'self-review is not allowed' using errcode='42501';
  end if;
  perform internal.assert_queue_claim(c,actor,p_claim_generation,p_claim_nonce);
  if r.status is distinct from 'open' then
    raise exception 'current live queue claim required' using errcode='42501';
  end if;
  if r.report_origin='staff' then
    result:=jsonb_build_object('id',r.id,'origin','staff','category','duplicate_event',
      'description',r.description,'status',r.status,'created_at',r.created_at,
      'post_a',jsonb_build_object('id',r.duplicate_post_a,'reported_revision',r.duplicate_revision_a,
        'current',internal.duplicate_public_event_view(r.duplicate_post_a)),
      'post_b',jsonb_build_object('id',r.duplicate_post_b,'reported_revision',r.duplicate_revision_b,
        'current',internal.duplicate_public_event_view(r.duplicate_post_b)));
  else
    result:=jsonb_build_object('id',r.id,'category',r.category,'severity',r.severity,
      'description',r.description,'status',r.status,'created_at',r.created_at,
      'reporter_signed_in',r.reporter_id is not null,'subject_account_id',r.subject_account_id,
      'subject_open_reports',(select count(*) from private.reports x
        where x.subject_account_id=r.subject_account_id and x.status='open'),
      'post',case when r.post_id is not null then internal.post_review_view(r.post_id) end);
  end if;
  perform internal.staff_actor('report:resolve');
  select q.* into c from private.queue_claims q where q.report_id=r.id;
  perform internal.assert_queue_claim(c,actor,p_claim_generation,p_claim_nonce);
  return result;
end;
$$;
revoke all on function internal.staff_review_report(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.staff_review_report(uuid,text,uuid) to authenticated;
perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$staff_event_duplicate_flags$;

-- Source: docs/backend-foundation/prototypes/post-contact-preferences.sql
-- Explicit private listing/event contact selection. Local candidate only.
-- No raw number, public reveal or business contact policy is introduced.
do $post_contact_preferences$
begin
create function internal.canonical_post_channels(p_value jsonb)
returns text[] language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
  if jsonb_typeof(p_value) is distinct from 'array' then
    raise exception 'contact channels must be an array' using errcode='22023';
  end if;
  if jsonb_array_length(p_value)>4 or exists(select 1 from jsonb_array_elements(p_value) x
    where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('call','whatsapp','form','in_app')) then
    raise exception 'choose supported contact channels' using errcode='22023';
  end if;
  return array(select channel from unnest(array['call','whatsapp','form']) with ordinality c(channel,position)
    where exists(select 1 from jsonb_array_elements_text(p_value) x
      where case when x='in_app' then 'form' else x end=c.channel) order by position);
end;
$$;
revoke all on function internal.canonical_post_channels(jsonb) from public,anon,authenticated,service_role;

create table private.post_contacts (
  post_id uuid primary key,
  post_kind text not null check(post_kind in ('listing','event')),
  channels text[] not null check(channels=internal.canonical_post_channels(to_jsonb(channels))),
  foreign key(post_id,post_kind) references private.posts(id,kind) on delete cascade
);
alter table private.post_contacts enable row level security;
revoke all on private.post_contacts from public,anon,authenticated,service_role;
create trigger post_contacts_edit_frozen before insert or update or delete on private.post_contacts
  for each row execute function internal.post_edit_guard();
create trigger post_contacts_no_truncate before truncate on private.post_contacts
  for each statement execute function internal.core_no_detail_truncate();

-- Selection is not an assurance claim. Each publication boundary checks the
-- current canonical proof; a phone is never duplicated into a post/contact row.
create function internal.assert_post_contacts_ready(p_post_id uuid,p_staff boolean)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare post private.posts; chosen text[]; has_phone boolean; actor uuid;
begin
  if p_staff is null then raise exception 'caller context required' using errcode='22023'; end if;
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  select * into post from private.posts p where p.id=p_post_id;
  select c.channels into chosen from private.post_contacts c where c.post_id=p_post_id;
  select exists(select 1 from private.verification_phone_proofs f
    where f.owner_id=post.owner_id and f.revoked_at is null) into has_phone;
  -- Derive the real caller again before any data-dependent refusal, including
  -- combined caller/phone loss during earlier post/media/projection waits.
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  if post.id is null then raise exception 'post unavailable' using errcode='22023'; end if;
  if not p_staff and post.owner_id<>actor then
    raise exception 'owned post required' using errcode='42501';
  end if;
  if post.kind='business' then return; end if;
  if chosen is null or cardinality(chosen)=0 then
    raise exception 'choose at least one contact channel' using errcode='22023',detail='contact_channels_required';
  end if;
  if chosen && array['call','whatsapp'] and not has_phone then
    raise exception 'verify your account phone for selected contact channels' using errcode='PT409',detail='contact_phone_required';
  end if;
end;$$;
revoke all on function internal.assert_post_contacts_ready(uuid,boolean) from public,anon,authenticated,service_role;

create function internal.get_owner_post_contacts(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'kind',p.kind,'status',p.status,'revision',p.revision,
    'edit_of',p.edit_of,'channels',to_jsonb(c.channels),
    'phone_ready',exists(select 1 from private.verification_phone_proofs f
      where f.owner_id=actor and f.revoked_at is null)) into result
  from private.posts p left join private.post_contacts c on c.post_id=p.id
  where p.id=p_post_id and p.owner_id=actor and p.kind in ('listing','event');
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_owner_post_contacts(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_owner_post_contacts(uuid) to authenticated;
create function api.get_owner_post_contacts(p_post_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_owner_post_contacts(p_post_id);
$$;
revoke all on function api.get_owner_post_contacts(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_owner_post_contacts(uuid) to authenticated;

create function internal.set_post_contacts(p_post_id uuid,p_expected_revision integer,p_channels jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post private.posts; chosen text[]; rev integer;
begin
  perform internal.assert_post_revision(p_expected_revision);
  chosen:=internal.canonical_post_channels(p_channels);
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  select * into post from private.posts p where p.id=p_post_id and p.owner_id=actor for update;
  perform internal.price_draft_actor();
  if post.id is null or post.kind not in ('listing','event') then
    raise exception 'post unavailable' using errcode='22023';
  end if;
  if post.status not in ('draft','rejected','paused') then
    raise exception 'only drafts can be edited' using errcode='22023';
  end if;
  if post.revision<>p_expected_revision then raise exception 'post changed' using errcode='PT409'; end if;
  insert into private.post_contacts(post_id,post_kind,channels) values(post.id,post.kind,chosen)
    on conflict(post_id) do update set channels=excluded.channels;
  update private.posts set revision=revision+1,content_updated_at=statement_timestamp()
    where id=post.id returning revision into rev;
  perform internal.price_draft_actor();
  return jsonb_build_object('id',post.id,'revision',rev,'channels',to_jsonb(chosen));
end;
$$;
revoke all on function internal.set_post_contacts(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.set_post_contacts(uuid,integer,jsonb) to authenticated;
create function api.set_post_contacts(p_post_id uuid,p_expected_revision integer,p_channels jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.set_post_contacts(p_post_id,p_expected_revision,p_channels);
$$;
revoke all on function api.set_post_contacts(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function api.set_post_contacts(uuid,integer,jsonb) to authenticated;

create or replace function internal.create_core_draft(p_kind text,p_area text,p_category_key text,p_detail jsonb,p_activity_key text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post uuid; starts timestamptz; ends timestamptz; tz text; stored_activity text;
begin
  if not exists(select 1 from private.post_category_contracts c where c.category_key=p_category_key and c.kind=p_kind and c.area=p_area) then
    raise exception 'invalid kind area category' using errcode='22023';
  end if;
  if exists(select 1 from private.categories c where c.key=p_category_key and c.activity_required)
    and p_activity_key is null then
    raise exception 'activity required for this category' using errcode='22023';
  end if;
  if p_activity_key is not null and not exists(select 1 from private.category_activities a
    where a.category_key=p_category_key and a.key=p_activity_key) then
    raise exception 'activity does not belong to this category' using errcode='22023';
  end if;
  if jsonb_typeof(p_detail) is distinct from 'object' or octet_length(p_detail::text)>512 then
    raise exception 'invalid detail payload' using errcode='22023';
  end if;
  if p_kind='event' then
    if not(array(select jsonb_object_keys(p_detail)) <@ array['starts_at','ends_at','timezone','contact_channels'])
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
  elsif p_kind='business' and p_detail<>'{}'::jsonb then
    raise exception 'business detail fields are not implemented' using errcode='22023';
  elsif p_kind='listing' and p_detail-'contact_channels'<>'{}'::jsonb then raise exception 'detail fields not implemented in this identity fixture' using errcode='22023';
  end if;
  if p_detail ? 'contact_channels' then
    perform internal.canonical_post_channels(p_detail->'contact_channels');
  end if;
  -- Draft allowance (DEC-29): 5 plus 1 per post in the owner's current
  -- packages (internal.draft_allowance in publication.sql). Edit copies are
  -- not counted. Never accept a caller-provided limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,417));
  if (select count(*) from private.posts p where p.owner_id=actor and p.status='draft' and p.edit_of is null)
      >=internal.draft_allowance(actor) then
    raise exception 'draft limit reached' using errcode='PT429';
  end if;
  insert into private.posts(owner_id,kind,area,category_key,activity_key) values(actor,p_kind,p_area,p_category_key,p_activity_key) returning id,activity_key into post,stored_activity;
  if p_kind='listing' then insert into private.listing_details(post_id) values(post);
  elsif p_kind='business' then insert into private.business_details(post_id) values(post);
  else insert into private.event_details(post_id,starts_at,ends_at,timezone) values(post,starts,ends,tz); end if;
  if p_detail ? 'contact_channels' then
    insert into private.post_contacts(post_id,post_kind,channels)
      values(post,p_kind,internal.canonical_post_channels(p_detail->'contact_channels'));
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id',post,'kind',p_kind,'area',p_area,'category_key',p_category_key,'status','draft','revision',1)
    || case when stored_activity is not null then jsonb_build_object('activity_key',stored_activity) else '{}'::jsonb end;
end;
$$;

create or replace function internal.create_post_edit(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); original private.posts; edit_id uuid := pg_catalog.gen_random_uuid();
begin
  perform internal.assert_post_revision(p_expected_revision);
  select * into original from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found or original.edit_of is not null then raise exception 'post not found' using errcode = '22023'; end if;
  if original.status <> 'live' then
    raise exception 'only live posts are edited through review' using errcode = '22023';
  end if;
  if original.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if exists (select 1 from private.posts e where e.edit_of = original.id) then
    raise exception 'this post already has an edit waiting' using errcode = 'PT409';
  end if;
  insert into private.posts (id, owner_id, kind, area, category_key, activity_key, title, description,
    province_id, city_id, locality_label, edit_of)
  values (edit_id, original.owner_id, original.kind, original.area, original.category_key, original.activity_key,
    original.title, original.description, original.province_id, original.city_id, original.locality_label, original.id);
  if original.kind = 'listing' then
    insert into private.listing_details select (jsonb_populate_record(null::private.listing_details,
      to_jsonb(d) || jsonb_build_object('post_id', edit_id))).* from private.listing_details d where d.post_id = original.id;
  elsif original.kind = 'business' then
    insert into private.business_details select (jsonb_populate_record(null::private.business_details,
      to_jsonb(d) || jsonb_build_object('post_id', edit_id))).* from private.business_details d where d.post_id = original.id;
  else
    insert into private.event_details select (jsonb_populate_record(null::private.event_details,
      to_jsonb(d) || jsonb_build_object('post_id', edit_id))).* from private.event_details d where d.post_id = original.id;
  end if;
  insert into private.post_contacts(post_id,post_kind,channels)
    select edit_id,c.post_kind,c.channels from private.post_contacts c where c.post_id=original.id;
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = original.id) order by m.id for update;
  insert into private.post_media select (jsonb_populate_record(null::private.post_media,
    to_jsonb(pm) || jsonb_build_object('post_id', edit_id))).* from private.post_media pm where pm.post_id = original.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', edit_id, 'edit_of', original.id, 'status', 'draft', 'revision', 1,
    'edits_remaining', greatest(0, internal.edit_allowance(original.id) - internal.approved_edit_count(original.id)),
    'price_change_always_allowed', true);
end;
$$;

create or replace function internal.edit_is_price_only(p_original_id uuid, p_edit_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce((
    select o.kind = 'listing'
      and (o.category_key, o.activity_key, o.title, o.description, o.province_id, o.city_id, o.locality_label)
        is not distinct from (e.category_key, e.activity_key, e.title, e.description, e.province_id, e.city_id, e.locality_label)
      and (to_jsonb(od) - array['post_id', 'price_mode', 'price_cents', 'price_negotiable'])
        = (to_jsonb(ed) - array['post_id', 'price_mode', 'price_cents', 'price_negotiable'])
      and (select c.channels from private.post_contacts c where c.post_id=o.id)
        is not distinct from (select c.channels from private.post_contacts c where c.post_id=e.id)
      and (od.price_mode, od.price_cents, od.price_negotiable) is distinct from (ed.price_mode, ed.price_cents, ed.price_negotiable)
      and coalesce((select jsonb_agg(to_jsonb(pm) - 'post_id' order by pm.purpose, pm.position)
             from private.post_media pm where pm.post_id = o.id), '[]')
        = coalesce((select jsonb_agg(to_jsonb(pm) - 'post_id' order by pm.purpose, pm.position)
             from private.post_media pm where pm.post_id = e.id), '[]')
    from private.posts o
    join private.posts e on e.id = p_edit_id and e.edit_of = o.id
    join private.listing_details od on od.post_id = o.id
    join private.listing_details ed on ed.post_id = e.id
    where o.id = p_original_id), false);
$$;

create or replace function internal.submit_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  photos integer;
  videos integer;
  photo_limit integer;
  video_limit integer;
  rev integer;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'this post cannot be submitted now' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  perform internal.price_draft_actor();
  perform internal.assert_post_contacts_ready(post.id,false);
  if post.title is null then
    raise exception 'title length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 2 else 5 end,
    'maxLength',case when post.kind='event' then 120 else 100 end),to_jsonb(post.title));
  if post.kind in ('listing','event') and post.description is null then
    raise exception 'description length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 0 else 20 end,
    'maxLength',case when post.kind='business' then 3000 else 5000 end),to_jsonb(coalesce(post.description,'')));
  if post.province_id is null or (post.city_id is null and post.locality_label is null) then
    raise exception 'province and city or locality required' using errcode = '22023';
  end if;
  if post.kind='listing' then
    if not exists(select 1 from private.listing_details d where d.post_id=post.id and d.price_mode is not null) then
      raise exception 'choose an explicit listing price' using errcode='22023';
    end if;
    perform internal.validate_listing_attributes(post.category_key,d.attributes,true)
      from private.listing_details d where d.post_id=post.id;
  end if;
  select count(distinct pm.object_id) into photos from private.post_media pm
    where pm.post_id = post.id and pm.purpose in ('cover', 'gallery');
  select count(distinct pm.object_id) into videos from private.post_media pm where pm.post_id=post.id and pm.purpose='video';
  if ((post.kind='listing' and post.category_key<>'jobs_services') or (post.kind='business' and post.area='tourism_events')) and photos = 0 then
    raise exception 'at least one photo is required' using errcode = '22023';
  end if;
  if post.kind='event' and photos+videos=0 then raise exception 'at least one photo or video required' using errcode='22023'; end if;
  if photos > 0 and not exists (select 1 from private.post_media pm where pm.post_id = post.id and pm.purpose = 'cover') then
    raise exception 'choose a cover photo' using errcode = '22023';
  end if;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = post.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = '22023';
  end if;
  if post.edit_of is not null then
    -- A live edit uses the live post's funding: no new activation or fair use.
    if not exists (select 1 from private.posts o where o.id = post.edit_of and o.status = 'live') then
      raise exception 'the live post is no longer published' using errcode = 'PT409';
    end if;
    if internal.edit_is_price_only(post.edit_of, post.id) then
      if internal.recent_price_change(post.edit_of) then
        raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
      end if;
    elsif internal.approved_edit_count(post.edit_of) >= internal.edit_allowance(post.edit_of) then
      raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
    end if;
    select f.max_photos, f.max_videos into photo_limit, video_limit
      from internal.post_funding(post.edit_of) f where f.funded_until > statement_timestamp();
    if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode = '22023';
    end if;
  elsif post.kind = 'event' then
    -- Free events: fair use of 5 active (pending or live) and 10 submissions per 30 days.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 909));
    perform internal.price_draft_actor(); -- fresh authority before quota or duplicate errors
    if (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.status in ('pending_moderation', 'live') and p.id <> post.id) >= 5
      or (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.submitted_at > statement_timestamp() - interval '30 days' and p.id <> post.id) >= 10 then
      raise exception 'event fair-use limit reached' using errcode = 'PT429';
    end if;
  else
    perform internal.activate_post(post.id);
    select e.max_photos,e.max_videos into photo_limit,video_limit
      from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
      where a.post_id=post.id and a.released_at is null;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode='22023';
    end if;
  end if;
  if post.kind='event' then
    perform internal.assert_event_duplicate_absent(post.id,false);
    if post.edit_of is not null and not exists(
      select 1 from internal.post_funding(post.edit_of) f where f.funded_until>clock_timestamp()) then
      raise exception 'funding or event window has ended' using errcode='PT409';
    end if;
  end if;
  update private.posts set status = 'pending_moderation', submitted_at = statement_timestamp(),
    status_reason = null, revision = revision + 1
  where id = post.id returning revision into rev;
  perform internal.assert_post_contacts_ready(post.id,false);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'pending_moderation', 'revision', rev);
end;
$$;

create or replace function internal.apply_post_edit(p_original_id uuid, p_edit_id uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare original private.posts; edit private.posts; photo_limit integer; video_limit integer;
  detail jsonb; links jsonb; rev integer; price_only boolean; selected_channels text[];
  old_event_until timestamptz; new_event_until timestamptz;
begin
  select * into original from private.posts p where p.id = p_original_id;
  select * into edit from private.posts p where p.id = p_edit_id and p.edit_of = p_original_id;
  if original.kind='event' then
    select e.ends_at into old_event_until from private.event_details e where e.post_id=original.id;
    select e.ends_at into new_event_until from private.event_details e where e.post_id=edit.id;
    if old_event_until is null or original.visible_until is null or new_event_until is null then
      raise exception 'event window is unavailable' using errcode='PT409';
    end if;
  end if;
  if original.status not in ('live', 'paused') then
    raise exception 'the live post is no longer published' using errcode = 'PT409';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode = 'PT409';
  end if;
  perform internal.assert_post_contacts_ready(edit.id,true);
  select c.channels into selected_channels from private.post_contacts c where c.post_id=edit.id;
  price_only := internal.edit_is_price_only(original.id, edit.id);
  if price_only and internal.recent_price_change(original.id) then
    raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
  end if;
  if not price_only and internal.approved_edit_count(original.id) >= internal.edit_allowance(original.id) then
    raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
  end if;
  select f.max_photos, f.max_videos into photo_limit, video_limit
    from internal.post_funding(original.id) f where f.funded_until > statement_timestamp();
  if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
  -- Lock linked objects before reading their state, as linking and cleanup do.
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = edit.id) order by m.id for update;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = edit.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = 'PT409';
  end if;
  if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose <> 'video') > photo_limit
    or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose = 'video') > video_limit then
    raise exception 'funded media allowance changed since submission' using errcode = 'PT409';
  end if;
  if original.kind='event' and original.status='live' then
    perform internal.assert_event_duplicate_absent(edit.id,true);
  end if;
  if not exists(select 1 from private.current_account_access u where u.id=original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode='PT409';
  end if;
  if original.kind='event' and (old_event_until<=clock_timestamp()
    or original.visible_until<=clock_timestamp() or new_event_until<=clock_timestamp()) then
    raise exception 'original or proposed event window has ended' using errcode='PT409';
  end if;
  select coalesce(jsonb_agg(to_jsonb(pm)), '[]') into links from private.post_media pm where pm.post_id = edit.id;
  detail := case original.kind
      when 'listing' then (select to_jsonb(d) from private.listing_details d where d.post_id = edit.id)
      when 'business' then (select to_jsonb(d) from private.business_details d where d.post_id = edit.id)
      else (select to_jsonb(d) from private.event_details d where d.post_id = edit.id) end
    || jsonb_build_object('post_id', original.id);
  delete from private.posts where id = edit.id; -- with its details, links and queue claim
  update private.posts set category_key = edit.category_key, activity_key = edit.activity_key, title = edit.title,
    description = edit.description, province_id = edit.province_id, city_id = edit.city_id,
    locality_label = edit.locality_label,
    visible_until = case when original.kind='event' then new_event_until else original.visible_until end,
    revision = revision + 1, content_updated_at = statement_timestamp()
  where id = original.id returning revision into rev;
  if original.kind = 'listing' then
    delete from private.listing_details where post_id = original.id;
    insert into private.listing_details select (jsonb_populate_record(null::private.listing_details, detail)).*;
  elsif original.kind = 'business' then
    delete from private.business_details where post_id = original.id;
    insert into private.business_details select (jsonb_populate_record(null::private.business_details, detail)).*;
  else
    delete from private.event_details where post_id = original.id;
    insert into private.event_details select (jsonb_populate_record(null::private.event_details, detail)).*;
  end if;
  delete from private.post_media where post_id = original.id;
  insert into private.post_media
  select (jsonb_populate_record(null::private.post_media, l || jsonb_build_object('post_id', original.id))).*
  from jsonb_array_elements(links) l;
  if original.kind in ('listing','event') then
    insert into private.post_contacts(post_id,post_kind,channels) values(original.id,original.kind,selected_channels)
      on conflict(post_id) do update set channels=excluded.channels;
  end if;
  perform internal.write_post_projection(original.id);
  if not exists(select 1 from private.current_account_access u where u.id=original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode='PT409';
  end if;
  if original.kind='event' and (old_event_until<=clock_timestamp()
    or original.visible_until<=clock_timestamp() or new_event_until<=clock_timestamp()) then
    raise exception 'original or proposed event window has ended' using errcode='PT409';
  end if;

  perform internal.assert_post_contacts_ready(original.id,true);
  return jsonb_build_object('revision', rev, 'price_only', price_only);
end;
$$;

create or replace function internal.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_reason text,
  p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.staff_actor('post:moderate');
  post private.posts;
  original_id uuid;
  funded_until timestamptz;
  photo_limit integer;
  video_limit integer;
  rev integer;
  merged jsonb;
begin
  perform internal.assert_post_revision(p_expected_revision);
  if p_decision is null or p_decision not in ('approve', 'reject')
    or (p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) not between 5 and 500) then
    raise exception 'decision and, for rejections, a reason are required' using errcode = '22023';
  end if;
  -- An edit locks its live post before the copy, like every owner command.
  select p.edit_of into original_id from private.posts p where p.id = p_post_id;
  if original_id is not null then
    perform 1 from private.posts p where p.id = original_id for update;
  end if;
  select * into post from private.posts p where p.id = p_post_id for update;
  if not found or post.status <> 'pending_moderation' or post.edit_of is distinct from original_id then
    raise exception 'post is not awaiting moderation' using errcode = '22023';
  end if;
  actor := internal.staff_actor('post:moderate'); -- authority after any lock wait
  if post.owner_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  perform internal.consume_queue_claim('post', post.id, actor, p_claim_generation, p_claim_nonce);
  if post.revision <> p_expected_revision then raise exception 'post changed since review' using errcode = 'PT409'; end if;
  if p_decision='approve' then perform internal.assert_post_contacts_ready(post.id,true); end if;
  if p_decision = 'reject' then
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'moderation'
      where post_id = post.id and released_at is null;
    update private.posts set status = 'rejected', status_reason = btrim(p_reason), revision = revision + 1
      where id = post.id;
  elsif original_id is not null then
    merged := internal.apply_post_edit(original_id, post.id);
    rev := (merged->>'revision')::integer;
  else
    if post.kind='event' then perform internal.assert_event_duplicate_absent(post.id,true); end if;
    if not exists(select 1 from private.current_account_access u where u.id=post.owner_id) then
      raise exception 'post owner is no longer eligible' using errcode='PT409';
    end if;
    select f.funded_until, f.max_photos, f.max_videos into funded_until, photo_limit, video_limit
      from internal.post_funding(post.id) f;
    if funded_until is null or funded_until <= (case when post.kind='event' then clock_timestamp() else statement_timestamp() end) then
      raise exception 'funding or event window has ended' using errcode = 'PT409';
    end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose='video')>video_limit then
      raise exception 'funded media allowance changed since submission' using errcode='PT409';
    end if;
    update private.posts set status = 'live', published_at = statement_timestamp(), visible_until = funded_until,
      revision = revision + 1 where id = post.id;
    perform internal.write_post_projection(post.id);
    if post.kind='event' and (funded_until<=clock_timestamp() or not exists(
      select 1 from private.current_account_access u where u.id=post.owner_id)) then
      raise exception 'event window or owner is no longer eligible' using errcode='PT409';
    end if;

  end if;
  if p_decision='approve' then perform internal.assert_post_contacts_ready(coalesce(original_id,post.id),true); end if;
  perform internal.staff_actor('post:moderate'); -- authority after claim-row and media waits
  insert into private.moderation_log (post_id, edit_id, staff_id, decision, post_revision, reason, price_only)
  values (coalesce(original_id, post.id), case when original_id is not null then post.id end, actor, p_decision,
    p_expected_revision, nullif(btrim(coalesce(p_reason, '')), ''), coalesce((merged->>'price_only')::boolean, false));
  if original_id is not null then
    return jsonb_build_object('id', post.id, 'edit_of', original_id,
      'status', case when p_decision = 'approve' then 'merged' else 'rejected' end, 'post_revision', rev,
      'price_only', coalesce((merged->>'price_only')::boolean, false));
  end if;
  return jsonb_build_object('id', post.id, 'status', case when p_decision = 'approve' then 'live' else 'rejected' end,
    'visible_until', funded_until);
end;
$$;
perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$post_contact_preferences$;

-- Source: docs/backend-foundation/prototypes/publication-verification-readiness.sql
-- Publication verification readiness only. Guarded local foundation module.
-- Posting-term/version/document binding and profile/retention policy remain separate.
do $publication_verification_readiness$
begin

create function internal.assert_posting_verification_ready(p_post_id uuid,p_staff boolean)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare actor uuid; owner uuid; ready boolean;
begin
  if p_staff is null then raise exception 'caller context required' using errcode='22023'; end if;
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  select p.owner_id into owner from private.posts p where p.id=p_post_id;
  ready:=internal.current_verified_identity(owner) is not null;
  -- No new verification/evidence locks beneath post/media locks. Read canonical
  -- current facts and rederive the real caller before a data-dependent refusal.
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  if owner is null then raise exception 'post unavailable' using errcode='22023'; end if;
  if (not p_staff and owner<>actor) or (p_staff and owner=actor) then
    raise exception 'caller cannot publish this post' using errcode='42501';
  end if;
  if not ready then
    raise exception 'complete identity verification before posting' using errcode='42501',
      detail='posting_verification_required';
  end if;
end;
$$;
revoke all on function internal.assert_posting_verification_ready(uuid,boolean)
  from public,anon,authenticated,service_role;

create function internal.get_owner_verification_readiness()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  with facts as materialized (
    select internal.current_verified_identity(actor) is not null as verified,
      exists(select 1 from private.verification_phone_proofs p
        where p.owner_id=actor and p.revoked_at is null) as phone,
      exists(select 1 from private.verification_localities l
        where l.owner_id=actor) as locality
  )
  select jsonb_build_object(
    'verification_ready',f.verified and f.phone and f.locality,
    'phone_verified',f.phone,'locality_confirmed',f.locality
  ) into result from facts f;
  -- Canonical readiness is VOLATILE; the conservative conjunction guarantees
  -- the DTO implication even across concurrent proof transitions. It is a
  -- current observation, never permission for a later submit command.
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_owner_verification_readiness()
  from public,anon,authenticated,service_role;
grant execute on function internal.get_owner_verification_readiness() to authenticated;
create function api.get_owner_verification_readiness()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_owner_verification_readiness();
$$;
revoke all on function api.get_owner_verification_readiness()
  from public,anon,authenticated,service_role;
grant execute on function api.get_owner_verification_readiness() to authenticated;

create or replace function internal.submit_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  photos integer;
  videos integer;
  photo_limit integer;
  video_limit integer;
  rev integer;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'this post cannot be submitted now' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  perform internal.price_draft_actor();
  perform internal.assert_post_contacts_ready(post.id,false);
  perform internal.assert_posting_verification_ready(post.id,false);
  if post.title is null then
    raise exception 'title length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 2 else 5 end,
    'maxLength',case when post.kind='event' then 120 else 100 end),to_jsonb(post.title));
  if post.kind in ('listing','event') and post.description is null then
    raise exception 'description length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 0 else 20 end,
    'maxLength',case when post.kind='business' then 3000 else 5000 end),to_jsonb(coalesce(post.description,'')));
  if post.province_id is null or (post.city_id is null and post.locality_label is null) then
    raise exception 'province and city or locality required' using errcode = '22023';
  end if;
  if post.kind='listing' then
    if not exists(select 1 from private.listing_details d where d.post_id=post.id and d.price_mode is not null) then
      raise exception 'choose an explicit listing price' using errcode='22023';
    end if;
    perform internal.validate_listing_attributes(post.category_key,d.attributes,true)
      from private.listing_details d where d.post_id=post.id;
  end if;
  select count(distinct pm.object_id) into photos from private.post_media pm
    where pm.post_id = post.id and pm.purpose in ('cover', 'gallery');
  select count(distinct pm.object_id) into videos from private.post_media pm where pm.post_id=post.id and pm.purpose='video';
  if ((post.kind='listing' and post.category_key<>'jobs_services') or (post.kind='business' and post.area='tourism_events')) and photos = 0 then
    raise exception 'at least one photo is required' using errcode = '22023';
  end if;
  if post.kind='event' and photos+videos=0 then raise exception 'at least one photo or video required' using errcode='22023'; end if;
  if photos > 0 and not exists (select 1 from private.post_media pm where pm.post_id = post.id and pm.purpose = 'cover') then
    raise exception 'choose a cover photo' using errcode = '22023';
  end if;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = post.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = '22023';
  end if;
  if post.edit_of is not null then
    -- A live edit uses the live post's funding: no new activation or fair use.
    if not exists (select 1 from private.posts o where o.id = post.edit_of and o.status = 'live') then
      raise exception 'the live post is no longer published' using errcode = 'PT409';
    end if;
    if internal.edit_is_price_only(post.edit_of, post.id) then
      if internal.recent_price_change(post.edit_of) then
        raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
      end if;
    elsif internal.approved_edit_count(post.edit_of) >= internal.edit_allowance(post.edit_of) then
      raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
    end if;
    select f.max_photos, f.max_videos into photo_limit, video_limit
      from internal.post_funding(post.edit_of) f where f.funded_until > statement_timestamp();
    if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode = '22023';
    end if;
  elsif post.kind = 'event' then
    -- Free events: fair use of 5 active (pending or live) and 10 submissions per 30 days.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 909));
    perform internal.price_draft_actor(); -- fresh authority before quota or duplicate errors
    if (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.status in ('pending_moderation', 'live') and p.id <> post.id) >= 5
      or (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.submitted_at > statement_timestamp() - interval '30 days' and p.id <> post.id) >= 10 then
      raise exception 'event fair-use limit reached' using errcode = 'PT429';
    end if;
  else
    perform internal.activate_post(post.id);
    select e.max_photos,e.max_videos into photo_limit,video_limit
      from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
      where a.post_id=post.id and a.released_at is null;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode='22023';
    end if;
  end if;
  if post.kind='event' then
    perform internal.assert_event_duplicate_absent(post.id,false);
    if post.edit_of is not null and not exists(
      select 1 from internal.post_funding(post.edit_of) f where f.funded_until>clock_timestamp()) then
      raise exception 'funding or event window has ended' using errcode='PT409';
    end if;
  end if;
  update private.posts set status = 'pending_moderation', submitted_at = statement_timestamp(),
    status_reason = null, revision = revision + 1
  where id = post.id returning revision into rev;
  perform internal.assert_post_contacts_ready(post.id,false);
  perform internal.assert_posting_verification_ready(post.id,false);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'pending_moderation', 'revision', rev);
end;
$$;

create or replace function internal.apply_post_edit(p_original_id uuid, p_edit_id uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare original private.posts; edit private.posts; photo_limit integer; video_limit integer;
  detail jsonb; links jsonb; rev integer; price_only boolean; selected_channels text[];
  old_event_until timestamptz; new_event_until timestamptz;
begin
  select * into original from private.posts p where p.id = p_original_id;
  select * into edit from private.posts p where p.id = p_edit_id and p.edit_of = p_original_id;
  if original.kind='event' then
    select e.ends_at into old_event_until from private.event_details e where e.post_id=original.id;
    select e.ends_at into new_event_until from private.event_details e where e.post_id=edit.id;
    if old_event_until is null or original.visible_until is null or new_event_until is null then
      raise exception 'event window is unavailable' using errcode='PT409';
    end if;
  end if;
  if original.status not in ('live', 'paused') then
    raise exception 'the live post is no longer published' using errcode = 'PT409';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode = 'PT409';
  end if;
  perform internal.assert_post_contacts_ready(edit.id,true);
  perform internal.assert_posting_verification_ready(edit.id,true);
  select c.channels into selected_channels from private.post_contacts c where c.post_id=edit.id;
  price_only := internal.edit_is_price_only(original.id, edit.id);
  if price_only and internal.recent_price_change(original.id) then
    raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
  end if;
  if not price_only and internal.approved_edit_count(original.id) >= internal.edit_allowance(original.id) then
    raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
  end if;
  select f.max_photos, f.max_videos into photo_limit, video_limit
    from internal.post_funding(original.id) f where f.funded_until > statement_timestamp();
  if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
  -- Lock linked objects before reading their state, as linking and cleanup do.
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = edit.id) order by m.id for update;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = edit.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = 'PT409';
  end if;
  if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose <> 'video') > photo_limit
    or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose = 'video') > video_limit then
    raise exception 'funded media allowance changed since submission' using errcode = 'PT409';
  end if;
  if original.kind='event' and original.status='live' then
    perform internal.assert_event_duplicate_absent(edit.id,true);
  end if;
  if not exists(select 1 from private.current_account_access u where u.id=original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode='PT409';
  end if;
  if original.kind='event' and (old_event_until<=clock_timestamp()
    or original.visible_until<=clock_timestamp() or new_event_until<=clock_timestamp()) then
    raise exception 'original or proposed event window has ended' using errcode='PT409';
  end if;
  select coalesce(jsonb_agg(to_jsonb(pm)), '[]') into links from private.post_media pm where pm.post_id = edit.id;
  detail := case original.kind
      when 'listing' then (select to_jsonb(d) from private.listing_details d where d.post_id = edit.id)
      when 'business' then (select to_jsonb(d) from private.business_details d where d.post_id = edit.id)
      else (select to_jsonb(d) from private.event_details d where d.post_id = edit.id) end
    || jsonb_build_object('post_id', original.id);
  delete from private.posts where id = edit.id; -- with its details, links and queue claim
  update private.posts set category_key = edit.category_key, activity_key = edit.activity_key, title = edit.title,
    description = edit.description, province_id = edit.province_id, city_id = edit.city_id,
    locality_label = edit.locality_label,
    visible_until = case when original.kind='event' then new_event_until else original.visible_until end,
    revision = revision + 1, content_updated_at = statement_timestamp()
  where id = original.id returning revision into rev;
  if original.kind = 'listing' then
    delete from private.listing_details where post_id = original.id;
    insert into private.listing_details select (jsonb_populate_record(null::private.listing_details, detail)).*;
  elsif original.kind = 'business' then
    delete from private.business_details where post_id = original.id;
    insert into private.business_details select (jsonb_populate_record(null::private.business_details, detail)).*;
  else
    delete from private.event_details where post_id = original.id;
    insert into private.event_details select (jsonb_populate_record(null::private.event_details, detail)).*;
  end if;
  delete from private.post_media where post_id = original.id;
  insert into private.post_media
  select (jsonb_populate_record(null::private.post_media, l || jsonb_build_object('post_id', original.id))).*
  from jsonb_array_elements(links) l;
  if original.kind in ('listing','event') then
    insert into private.post_contacts(post_id,post_kind,channels) values(original.id,original.kind,selected_channels)
      on conflict(post_id) do update set channels=excluded.channels;
  end if;
  perform internal.write_post_projection(original.id);
  if not exists(select 1 from private.current_account_access u where u.id=original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode='PT409';
  end if;
  if original.kind='event' and (old_event_until<=clock_timestamp()
    or original.visible_until<=clock_timestamp() or new_event_until<=clock_timestamp()) then
    raise exception 'original or proposed event window has ended' using errcode='PT409';
  end if;

  perform internal.assert_post_contacts_ready(original.id,true);
  perform internal.assert_posting_verification_ready(original.id,true);
  return jsonb_build_object('revision', rev, 'price_only', price_only);
end;
$$;

create or replace function internal.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_reason text,
  p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.staff_actor('post:moderate');
  post private.posts;
  original_id uuid;
  funded_until timestamptz;
  photo_limit integer;
  video_limit integer;
  rev integer;
  merged jsonb;
begin
  perform internal.assert_post_revision(p_expected_revision);
  if p_decision is null or p_decision not in ('approve', 'reject')
    or (p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) not between 5 and 500) then
    raise exception 'decision and, for rejections, a reason are required' using errcode = '22023';
  end if;
  -- An edit locks its live post before the copy, like every owner command.
  select p.edit_of into original_id from private.posts p where p.id = p_post_id;
  if original_id is not null then
    perform 1 from private.posts p where p.id = original_id for update;
  end if;
  select * into post from private.posts p where p.id = p_post_id for update;
  if not found or post.status <> 'pending_moderation' or post.edit_of is distinct from original_id then
    raise exception 'post is not awaiting moderation' using errcode = '22023';
  end if;
  actor := internal.staff_actor('post:moderate'); -- authority after any lock wait
  if post.owner_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  perform internal.consume_queue_claim('post', post.id, actor, p_claim_generation, p_claim_nonce);
  if post.revision <> p_expected_revision then raise exception 'post changed since review' using errcode = 'PT409'; end if;
  if p_decision='approve' then
    perform internal.assert_post_contacts_ready(post.id,true);
    perform internal.assert_posting_verification_ready(post.id,true);
  end if;
  if p_decision = 'reject' then
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'moderation'
      where post_id = post.id and released_at is null;
    update private.posts set status = 'rejected', status_reason = btrim(p_reason), revision = revision + 1
      where id = post.id;
  elsif original_id is not null then
    merged := internal.apply_post_edit(original_id, post.id);
    rev := (merged->>'revision')::integer;
  else
    if post.kind='event' then perform internal.assert_event_duplicate_absent(post.id,true); end if;
    if not exists(select 1 from private.current_account_access u where u.id=post.owner_id) then
      raise exception 'post owner is no longer eligible' using errcode='PT409';
    end if;
    select f.funded_until, f.max_photos, f.max_videos into funded_until, photo_limit, video_limit
      from internal.post_funding(post.id) f;
    if funded_until is null or funded_until <= (case when post.kind='event' then clock_timestamp() else statement_timestamp() end) then
      raise exception 'funding or event window has ended' using errcode = 'PT409';
    end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose='video')>video_limit then
      raise exception 'funded media allowance changed since submission' using errcode='PT409';
    end if;
    update private.posts set status = 'live', published_at = statement_timestamp(), visible_until = funded_until,
      revision = revision + 1 where id = post.id;
    perform internal.write_post_projection(post.id);
    if post.kind='event' and (funded_until<=clock_timestamp() or not exists(
      select 1 from private.current_account_access u where u.id=post.owner_id)) then
      raise exception 'event window or owner is no longer eligible' using errcode='PT409';
    end if;

  end if;
  if p_decision='approve' then
    perform internal.assert_post_contacts_ready(coalesce(original_id,post.id),true);
    perform internal.assert_posting_verification_ready(coalesce(original_id,post.id),true);
  end if;
  perform internal.staff_actor('post:moderate'); -- authority after claim-row and media waits
  insert into private.moderation_log (post_id, edit_id, staff_id, decision, post_revision, reason, price_only)
  values (coalesce(original_id, post.id), case when original_id is not null then post.id end, actor, p_decision,
    p_expected_revision, nullif(btrim(coalesce(p_reason, '')), ''), coalesce((merged->>'price_only')::boolean, false));
  if original_id is not null then
    return jsonb_build_object('id', post.id, 'edit_of', original_id,
      'status', case when p_decision = 'approve' then 'merged' else 'rejected' end, 'post_revision', rev,
      'price_only', coalesce((merged->>'price_only')::boolean, false));
  end if;
  return jsonb_build_object('id', post.id, 'status', case when p_decision = 'approve' then 'live' else 'rejected' end,
    'visible_until', funded_until);
end;
$$;
perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$publication_verification_readiness$;

-- Source: docs/backend-foundation/prototypes/posting-terms-acceptance.sql
-- Account acceptance is explicit and version-bound. No real document is seeded:
-- the target stays closed to submissions until reviewed terms are published.
create table private.posting_terms_versions (
  version text primary key check (version ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  document_hash text not null check (document_hash ~ '^[A-Za-z0-9_-]{43}$'),
  published_at timestamptz not null default clock_timestamp(),
  unique(version,document_hash)
);
create table private.posting_terms_current (
  singleton boolean primary key default true check (singleton),
  version text not null references private.posting_terms_versions(version) on delete restrict
);
create table private.posting_terms_acceptances (
  owner_id uuid not null references auth.users(id) on delete cascade,
  version text not null,
  document_hash text not null,
  accepted_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,version),
  foreign key(version,document_hash) references private.posting_terms_versions(version,document_hash)
);
alter table private.posting_terms_versions enable row level security;
alter table private.posting_terms_current enable row level security;
alter table private.posting_terms_acceptances enable row level security;
revoke all on private.posting_terms_versions,private.posting_terms_current,
  private.posting_terms_acceptances from public,anon,authenticated,service_role;

create function internal.guard_posting_terms_document()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception 'published terms are immutable; publish a new version' using errcode='23514';
end;
$$;
revoke all on function internal.guard_posting_terms_document() from public,anon,authenticated,service_role;
create trigger posting_terms_document_immutable before update or delete on private.posting_terms_versions
  for each row execute function internal.guard_posting_terms_document();
create trigger posting_terms_acceptance_immutable before update on private.posting_terms_acceptances
  for each row execute function internal.guard_posting_terms_document();

create function internal.get_current_posting_terms()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('version',v.version,'document_hash',v.document_hash,
    'document_path','/terms/versions/'||v.version)
  from private.posting_terms_current c join private.posting_terms_versions v using(version)
  where c.singleton;
$$;
revoke all on function internal.get_current_posting_terms() from public,anon,authenticated,service_role;
grant execute on function internal.get_current_posting_terms() to anon,authenticated;
create function api.get_current_posting_terms()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.get_current_posting_terms();
$$;
revoke all on function api.get_current_posting_terms() from public,anon,authenticated,service_role;
grant execute on function api.get_current_posting_terms() to anon,authenticated;

create function internal.get_owner_posting_terms()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); document jsonb; accepted timestamptz;
begin
  document:=internal.get_current_posting_terms();
  if document is null then return null; end if;
  select a.accepted_at into accepted from private.posting_terms_acceptances a
    where a.owner_id=actor and a.version=document->>'version'
      and a.document_hash=document->>'document_hash';
  perform internal.price_draft_actor();
  return document||jsonb_build_object('accepted_at',accepted);
end;
$$;
revoke all on function internal.get_owner_posting_terms() from public,anon,authenticated,service_role;
grant execute on function internal.get_owner_posting_terms() to authenticated;
create function api.get_owner_posting_terms()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_owner_posting_terms();
$$;
revoke all on function api.get_owner_posting_terms() from public,anon,authenticated,service_role;
grant execute on function api.get_owner_posting_terms() to authenticated;

create function internal.accept_posting_terms(p_version text,p_document_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); current_version text; current_hash text; accepted timestamptz;
begin
  -- Serialize acceptance with a policy switch, without taking post locks.
  select c.version into current_version from private.posting_terms_current c
    where c.singleton for share;
  perform internal.price_draft_actor();
  if current_version is null then
    raise exception 'posting terms are not available' using errcode='PT503',detail='posting_terms_unavailable';
  end if;
  select v.document_hash into current_hash from private.posting_terms_versions v
    where v.version=current_version;
  if p_version is distinct from current_version or p_document_hash is distinct from current_hash then
    raise exception 'posting terms changed; review the current document' using errcode='PT409',detail='posting_terms_changed';
  end if;
  insert into private.posting_terms_acceptances(owner_id,version,document_hash)
    values(actor,current_version,current_hash) on conflict(owner_id,version) do nothing;
  select a.accepted_at into accepted from private.posting_terms_acceptances a
    where a.owner_id=actor and a.version=current_version and a.document_hash=current_hash;
  perform internal.price_draft_actor();
  return jsonb_build_object('version',current_version,'document_hash',current_hash,
    'document_path','/terms/versions/'||current_version,'accepted_at',accepted);
end;
$$;
revoke all on function internal.accept_posting_terms(text,text) from public,anon,authenticated,service_role;
grant execute on function internal.accept_posting_terms(text,text) to authenticated;
create function api.accept_posting_terms(p_version text,p_document_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.accept_posting_terms(p_version,p_document_hash);
$$;
revoke all on function api.accept_posting_terms(text,text) from public,anon,authenticated,service_role;
grant execute on function api.accept_posting_terms(text,text) to authenticated;

create function internal.guard_posting_terms_submission()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare current_version text; current_hash text;
begin
  if new.status<>'pending_moderation' then return new; end if;
  if tg_op='UPDATE' then
    if old.status='pending_moderation' then return new; end if;
  end if;
  -- The submission kernel separately enforces fresh owner/session authority.
  -- This guard enforces consent for every transition into the review queue,
  -- including direct API alternatives, without trusting client booleans.
  select c.version into current_version from private.posting_terms_current c
    where c.singleton for share;
  if current_version is null then
    raise exception 'posting terms are not available' using errcode='PT503',detail='posting_terms_unavailable';
  end if;
  select v.document_hash into current_hash from private.posting_terms_versions v
    where v.version=current_version;
  if not exists(select 1 from private.posting_terms_acceptances a
      where a.owner_id=new.owner_id and a.version=current_version and a.document_hash=current_hash) then
    raise exception 'accept current posting terms before submitting' using errcode='PT409',detail='posting_terms_required';
  end if;
  return new;
end;
$$;
revoke all on function internal.guard_posting_terms_submission() from public,anon,authenticated,service_role;
create trigger posting_terms_submission_guard before insert or update of status on private.posts
  for each row execute function internal.guard_posting_terms_submission();

-- Immutable published document metadata only; no account acceptance data.
insert into private.posting_terms_versions(version,document_hash) values('posting-v1','RAXTzmTyM5iMYeLy8Xv_NvnvzqsjUKPYq5hQaqqNS1Q');
insert into private.posting_terms_current(version) values('posting-v1');

