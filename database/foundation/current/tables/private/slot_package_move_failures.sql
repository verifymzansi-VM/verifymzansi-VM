-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.slot_package_move_failures (
  id uuid default gen_random_uuid() not null,
  package_id uuid not null,
  post_id uuid,
  direction text not null,
  tries integer default 1 not null,
  first_failed_at timestamp with time zone not null,
  last_failed_at timestamp with time zone not null,
  reason text not null,
  constraint slot_package_move_failures_direction_check CHECK (direction = ANY (ARRAY['into_package'::text, 'out_of_package'::text])),
  constraint slot_package_move_failures_pkey PRIMARY KEY (id),
  constraint slot_package_move_failures_reason_check CHECK (reason = 'busy'::text OR reason ~ '^error [0-9A-Z]{5}$'::text),
  constraint slot_package_move_failures_times_check CHECK (last_failed_at >= first_failed_at),
  constraint slot_package_move_failures_tries_check CHECK (tries >= 1)
);
alter table private.slot_package_move_failures owner to postgres;
alter table private.slot_package_move_failures enable row level security;
CREATE INDEX slot_package_move_failures_last_idx ON private.slot_package_move_failures USING btree (last_failed_at);
CREATE UNIQUE INDEX slot_package_move_failures_move_idx ON private.slot_package_move_failures USING btree (package_id, COALESCE(post_id, '00000000-0000-0000-0000-000000000000'::uuid), direction);
revoke all on private.slot_package_move_failures from public;
