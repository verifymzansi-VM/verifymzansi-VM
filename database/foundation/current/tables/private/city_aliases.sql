-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.city_aliases (
  city_id text not null,
  alias_normalized text not null,
  constraint city_aliases_alias_normalized_check CHECK (alias_normalized = lower(alias_normalized) AND length(alias_normalized) >= 1 AND length(alias_normalized) <= 120),
  constraint city_aliases_city_id_fkey FOREIGN KEY (city_id) REFERENCES private.cities(id),
  constraint city_aliases_pkey PRIMARY KEY (city_id, alias_normalized)
);
alter table private.city_aliases owner to postgres;
alter table private.city_aliases enable row level security;
CREATE INDEX city_aliases_lookup_idx ON private.city_aliases USING btree (alias_normalized);
revoke all on private.city_aliases from public;
