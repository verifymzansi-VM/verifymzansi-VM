-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.posting_terms_current (
  singleton boolean default true not null,
  version text not null,
  constraint posting_terms_current_pkey PRIMARY KEY (singleton),
  constraint posting_terms_current_singleton_check CHECK (singleton),
  constraint posting_terms_current_version_fkey FOREIGN KEY (version) REFERENCES private.posting_terms_versions(version) ON DELETE RESTRICT
);
alter table private.posting_terms_current owner to postgres;
alter table private.posting_terms_current enable row level security;
revoke all on private.posting_terms_current from public;
