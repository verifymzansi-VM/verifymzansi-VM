-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.category_activities (
  category_key text not null,
  key text not null,
  label text not null,
  field_group text,
  sort_order integer not null,
  constraint category_activities_category_key_fkey FOREIGN KEY (category_key) REFERENCES private.categories(key),
  constraint category_activities_field_group_check CHECK (field_group = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, 'F'::text])),
  constraint category_activities_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,79}$'::text),
  constraint category_activities_label_check CHECK (length(label) >= 1 AND length(label) <= 120),
  constraint category_activities_pkey PRIMARY KEY (category_key, key)
);
alter table private.category_activities owner to postgres;
alter table private.category_activities enable row level security;
revoke all on private.category_activities from public;
