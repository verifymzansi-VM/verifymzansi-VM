-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.privacy_request_rules (
  request_type text not null,
  days integer not null,
  extension_days integer not null,
  statutory boolean not null,
  source text not null,
  constraint privacy_request_rules_days_check CHECK (days > 0),
  constraint privacy_request_rules_extension_days_check CHECK (extension_days >= 0 AND extension_days <= 30),
  constraint privacy_request_rules_pkey PRIMARY KEY (request_type),
  constraint privacy_request_rules_request_type_check CHECK (request_type = ANY (ARRAY['access'::text, 'correction'::text, 'deletion'::text, 'objection'::text]))
);
alter table private.privacy_request_rules owner to postgres;
alter table private.privacy_request_rules enable row level security;
revoke all on private.privacy_request_rules from public;
