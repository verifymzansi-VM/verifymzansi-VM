-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.signup_blocked_domains (
  domain text not null,
  reason text default 'disposable'::text not null,
  added_at timestamp with time zone default statement_timestamp() not null,
  constraint signup_blocked_domains_domain_check CHECK (char_length(domain) >= 3 AND char_length(domain) <= 253 AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'::text),
  constraint signup_blocked_domains_pkey PRIMARY KEY (domain),
  constraint signup_blocked_domains_reason_check CHECK (reason = ANY (ARRAY['disposable'::text, 'abuse'::text]))
);
alter table private.signup_blocked_domains owner to postgres;
alter table private.signup_blocked_domains enable row level security;
create policy signup_blocked_domains_signup_hook on private.signup_blocked_domains as permissive for select to supabase_auth_admin
  using (true);
revoke all on private.signup_blocked_domains from public;
grant select (domain) on private.signup_blocked_domains to supabase_auth_admin;
