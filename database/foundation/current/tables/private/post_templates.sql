-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_templates (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  kind text default 'listing'::text not null,
  name text not null,
  data jsonb not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  updated_at timestamp with time zone default statement_timestamp() not null,
  constraint post_templates_data_check CHECK (jsonb_typeof(data) = 'object'::text AND octet_length(data::text) <= 16384),
  constraint post_templates_kind_check CHECK (kind = 'listing'::text),
  constraint post_templates_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 60),
  constraint post_templates_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint post_templates_pkey PRIMARY KEY (id)
);
alter table private.post_templates owner to postgres;
alter table private.post_templates enable row level security;
CREATE UNIQUE INDEX post_templates_owner_name_key ON private.post_templates USING btree (owner_id, lower(name));
revoke all on private.post_templates from public;
