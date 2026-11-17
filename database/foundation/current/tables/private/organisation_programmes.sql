-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.organisation_programmes (
  id uuid default gen_random_uuid() not null,
  organisation_id uuid not null,
  slug text not null,
  name text not null,
  description text,
  active boolean default true not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint organisation_programmes_description_check CHECK (description IS NULL OR internal.plain_text_valid(description, 1, 2000, true)),
  constraint organisation_programmes_id_organisation_id_key UNIQUE (id, organisation_id),
  constraint organisation_programmes_name_check CHECK (internal.plain_text_valid(name, 2, 160, false)),
  constraint organisation_programmes_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE CASCADE,
  constraint organisation_programmes_organisation_id_slug_key UNIQUE (organisation_id, slug),
  constraint organisation_programmes_pkey PRIMARY KEY (id),
  constraint organisation_programmes_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text AND char_length(slug) >= 3 AND char_length(slug) <= 60)
);
alter table private.organisation_programmes owner to postgres;
alter table private.organisation_programmes enable row level security;
revoke all on private.organisation_programmes from public;
