-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.intro_trial_rule (
  singleton boolean default true not null,
  first_applied_at timestamp with time zone not null,
  constraint intro_trial_rule_pkey PRIMARY KEY (singleton),
  constraint intro_trial_rule_singleton_check CHECK (singleton)
);
alter table private.intro_trial_rule owner to postgres;
alter table private.intro_trial_rule enable row level security;
revoke all on private.intro_trial_rule from public;
