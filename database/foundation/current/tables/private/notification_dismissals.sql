-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.notification_dismissals (
  notification_id uuid not null,
  dismissed_at timestamp with time zone default statement_timestamp() not null,
  constraint notification_dismissals_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES private.notifications(id) ON DELETE CASCADE,
  constraint notification_dismissals_pkey PRIMARY KEY (notification_id)
);
alter table private.notification_dismissals owner to postgres;
alter table private.notification_dismissals enable row level security;
revoke all on private.notification_dismissals from public;
