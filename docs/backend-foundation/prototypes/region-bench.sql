-- BF-01 regional benchmark fixture. Synthetic, deterministic and identical in
-- every candidate region. Applied only to disposable free benchmark projects,
-- never to the source or a target. Tables live in an unexposed schema; the
-- browser reaches them only through narrow definer functions that report their
-- own execution time, mirroring the proposed api/private split.

create extension if not exists pgcrypto with schema extensions;

create schema bench_private;
revoke all on schema bench_private from public, anon, authenticated;

create table bench_private.categories (
  id smallint primary key,
  slug text not null unique,
  area text not null check (area in ('market', 'business', 'tourism_events'))
);

insert into bench_private.categories (id, slug, area)
select g, 'category-' || g, (array['market', 'business', 'tourism_events'])[1 + g % 3]
from generate_series(1, 30) as g;

create table bench_private.posts (
  id bigint primary key,
  owner_id uuid,
  category_id smallint not null references bench_private.categories (id),
  title text not null,
  body text not null,
  price_cents bigint,
  town text not null,
  published_at timestamptz not null,
  status text not null default 'published',
  search tsvector generated always as (to_tsvector('simple', title || ' ' || body)) stored
);

-- Deterministic synthetic words; no real names, places or contacts.
with words as (
  select array[
    'bakkie', 'braai', 'fridge', 'couch', 'plumber', 'tutor', 'guesthouse', 'festival',
    'bicycle', 'laptop', 'welding', 'catering', 'tiling', 'safari', 'market', 'mechanic',
    'solar', 'garden', 'salon', 'printing', 'tyres', 'cottage', 'concert', 'boat'
  ] as w
)
insert into bench_private.posts (id, owner_id, category_id, title, body, price_cents, town, published_at)
select
  g,
  case when g % 50 = 0 then '00000000-0000-4000-8000-000000000001'::uuid end,
  1 + g % 30,
  initcap(w[1 + g % 24]) || ' ' || w[1 + (g / 24) % 24] || ' ' || g,
  repeat(w[1 + (g * 7) % 24] || ' ' || w[1 + (g * 11) % 24] || ' synthetic listing text ', 12),
  case when g % 5 = 0 then null else (g % 997) * 1000 end,
  'Town ' || (1 + g % 40),
  timestamptz '2026-01-01 00:00:00+00' + g * interval '1 minute'
from generate_series(1, 5000) as g, words;

create index posts_browse_idx on bench_private.posts (status, category_id, published_at desc, id desc);
create index posts_recent_idx on bench_private.posts (status, published_at desc, id desc);
create index posts_owner_idx on bench_private.posts (owner_id, published_at desc) where owner_id is not null;
create index posts_search_idx on bench_private.posts using gin (search);

create table bench_private.post_contacts (
  post_id bigint primary key references bench_private.posts (id),
  phone text not null
);

insert into bench_private.post_contacts (post_id, phone)
select id, '+27 00 000 ' || lpad((id % 10000)::text, 4, '0') from bench_private.posts;

create table bench_private.evidence_files (
  id bigint primary key,
  owner_id uuid not null,
  kind text not null,
  size_bytes integer not null,
  sha256 text not null,
  created_at timestamptz not null
);

insert into bench_private.evidence_files (id, owner_id, kind, size_bytes, sha256, created_at)
select g, '00000000-0000-4000-8000-000000000001', (array['id', 'proof_of_address', 'registration'])[1 + g % 3],
  100000 + g * 137, encode(extensions.digest('synthetic-' || g, 'sha256'), 'hex'),
  timestamptz '2026-01-01 00:00:00+00' + g * interval '1 hour'
from generate_series(1, 20) as g;

analyze bench_private.posts;
analyze bench_private.post_contacts;
analyze bench_private.evidence_files;

-- Each function returns {ms, n, rows}; ms is in-database execution time.
create function public.bench_browse(p_category smallint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := clock_timestamp();
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(r), '[]') into v_rows from (
    select p.id, p.title, p.price_cents, p.town, p.published_at, c.slug as category
    from bench_private.posts p join bench_private.categories c on c.id = p.category_id
    where p.status = 'published' and (p_category is null or p.category_id = p_category)
    order by p.published_at desc, p.id desc limit 24
  ) r;
  return jsonb_build_object('ms', extract(epoch from clock_timestamp() - v_start) * 1000,
    'n', jsonb_array_length(v_rows), 'rows', v_rows);
end $$;

create function public.bench_detail(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := clock_timestamp();
  v_row jsonb;
begin
  select to_jsonb(r) into v_row from (
    select p.id, p.title, p.body, p.price_cents, p.town, p.published_at, c.slug as category, c.area
    from bench_private.posts p join bench_private.categories c on c.id = p.category_id
    where p.id = p_id and p.status = 'published'
  ) r;
  return jsonb_build_object('ms', extract(epoch from clock_timestamp() - v_start) * 1000,
    'n', case when v_row is null then 0 else 1 end, 'rows', coalesce(v_row, 'null'));
end $$;

create function public.bench_search(p_q text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := clock_timestamp();
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(r), '[]') into v_rows from (
    select p.id, p.title, p.price_cents, p.town, p.published_at
    from bench_private.posts p
    where p.status = 'published' and p.search @@ websearch_to_tsquery('simple', p_q)
    order by p.published_at desc, p.id desc limit 24
  ) r;
  return jsonb_build_object('ms', extract(epoch from clock_timestamp() - v_start) * 1000,
    'n', jsonb_array_length(v_rows), 'rows', v_rows);
end $$;

create function public.bench_owner_posts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := clock_timestamp();
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(r), '[]') into v_rows from (
    select p.id, p.title, p.status, p.price_cents, p.published_at
    from bench_private.posts p where p.owner_id = v_uid
    order by p.published_at desc limit 50
  ) r;
  return jsonb_build_object('ms', extract(epoch from clock_timestamp() - v_start) * 1000,
    'n', jsonb_array_length(v_rows), 'rows', v_rows);
end $$;

create function public.bench_reveal_contact(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := clock_timestamp();
  v_phone text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select pc.phone into v_phone from bench_private.post_contacts pc
  join bench_private.posts p on p.id = pc.post_id
  where pc.post_id = p_id and p.status = 'published';
  return jsonb_build_object('ms', extract(epoch from clock_timestamp() - v_start) * 1000,
    'n', case when v_phone is null then 0 else 1 end, 'rows', to_jsonb(v_phone));
end $$;

create function public.bench_evidence_meta()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := clock_timestamp();
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(r), '[]') into v_rows from (
    select e.id, e.kind, e.size_bytes, e.sha256, e.created_at
    from bench_private.evidence_files e where e.owner_id = v_uid order by e.created_at desc
  ) r;
  return jsonb_build_object('ms', extract(epoch from clock_timestamp() - v_start) * 1000,
    'n', jsonb_array_length(v_rows), 'rows', v_rows);
end $$;

revoke execute on function public.bench_browse(smallint), public.bench_detail(bigint),
  public.bench_search(text), public.bench_owner_posts(), public.bench_reveal_contact(bigint),
  public.bench_evidence_meta() from public, anon, authenticated;
grant execute on function public.bench_browse(smallint), public.bench_detail(bigint),
  public.bench_search(text) to anon, authenticated;
grant execute on function public.bench_owner_posts(), public.bench_reveal_contact(bigint),
  public.bench_evidence_meta() to authenticated;

-- Dataset fingerprint; must be identical in every region.
create function public.bench_dataset_hash()
returns text language sql stable security definer set search_path = '' as $$
  select md5(
    (select string_agg(md5(row(p.id, p.owner_id, p.category_id, p.title, p.body, p.price_cents,
      p.town, p.published_at)::text), '' order by p.id) from bench_private.posts p)
    || (select string_agg(md5(row(c.*)::text), '' order by c.post_id) from bench_private.post_contacts c)
    || (select string_agg(md5(row(e.*)::text), '' order by e.id) from bench_private.evidence_files e)
  );
$$;
revoke execute on function public.bench_dataset_hash() from public, anon, authenticated;
grant execute on function public.bench_dataset_hash() to anon;
