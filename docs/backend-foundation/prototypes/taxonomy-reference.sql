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
