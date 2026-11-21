-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.identity_check_settings (
  id boolean default true not null,
  mode text default 'manual'::text not null,
  paused_until timestamp with time zone,
  pause_reason text,
  changed_at timestamp with time zone default statement_timestamp() not null,
  constraint identity_check_settings_mode_check CHECK (mode = ANY (ARRAY['manual'::text, 'staff_final'::text, 'automatic'::text])),
  constraint identity_check_settings_one_check CHECK (id),
  constraint identity_check_settings_pause_check CHECK ((paused_until IS NULL) = (pause_reason IS NULL) AND (pause_reason IS NULL OR (pause_reason = ANY (ARRAY['no_credit'::text, 'outage'::text, 'not_configured'::text])))),
  constraint identity_check_settings_pkey PRIMARY KEY (id)
);
alter table private.identity_check_settings owner to postgres;
alter table private.identity_check_settings enable row level security;
revoke all on private.identity_check_settings from public;
comment on table private.identity_check_settings is 'Automatic ID checks: the admin setting (manual, staff_final or automatic) and the current pause, one row.';
