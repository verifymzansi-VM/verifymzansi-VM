-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.programme_showcases (
  id uuid default gen_random_uuid() not null,
  organisation_id uuid not null,
  programme_id uuid,
  title text not null,
  placement text not null,
  enabled boolean default false not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  max_cards integer default 12 not null,
  province_id text,
  city_id text,
  display_order integer default 100 not null,
  sponsored_only boolean default false not null,
  revision integer default 1 not null,
  created_by uuid not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  updated_at timestamp with time zone default statement_timestamp() not null,
  constraint programme_showcases_check CHECK (ends_at > starts_at AND ends_at <= (starts_at + '366 days'::interval)),
  constraint programme_showcases_city_id_fkey FOREIGN KEY (city_id) REFERENCES private.cities(id),
  constraint programme_showcases_display_order_check CHECK (display_order >= 0 AND display_order <= 100000),
  constraint programme_showcases_max_cards_check CHECK (max_cards >= 3 AND max_cards <= 48),
  constraint programme_showcases_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE CASCADE,
  constraint programme_showcases_pkey PRIMARY KEY (id),
  constraint programme_showcases_placement_check CHECK (placement = ANY (ARRAY['home'::text, 'business'::text, 'tourism'::text, 'market'::text])),
  constraint programme_showcases_programme_id_organisation_id_fkey FOREIGN KEY (programme_id, organisation_id) REFERENCES private.organisation_programmes(id, organisation_id),
  constraint programme_showcases_province_id_fkey FOREIGN KEY (province_id) REFERENCES private.provinces(id),
  constraint programme_showcases_revision_check CHECK (revision >= 1 AND revision <= 2147483647),
  constraint programme_showcases_title_check CHECK (internal.plain_text_valid(title, 3, 120, false))
);
alter table private.programme_showcases owner to postgres;
alter table private.programme_showcases enable row level security;
CREATE INDEX programme_showcases_org_idx ON private.programme_showcases USING btree (organisation_id);
CREATE INDEX programme_showcases_placement_idx ON private.programme_showcases USING btree (placement, display_order) WHERE enabled;
revoke all on private.programme_showcases from public;
