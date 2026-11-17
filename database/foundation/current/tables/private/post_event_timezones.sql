-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_event_timezones (
  name text not null,
  constraint post_event_timezones_pkey PRIMARY KEY (name)
);
alter table private.post_event_timezones owner to postgres;
alter table private.post_event_timezones enable row level security;
revoke all on private.post_event_timezones from public;
