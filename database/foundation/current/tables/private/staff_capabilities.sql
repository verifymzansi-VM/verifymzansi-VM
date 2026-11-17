-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.staff_capabilities (
  role text not null,
  capability text not null,
  requires_recent_mfa boolean default false not null,
  constraint staff_capabilities_capability_check CHECK (capability ~ '^[a-z_]+:[a-z_]+$'::text),
  constraint staff_capabilities_pkey PRIMARY KEY (role, capability),
  constraint staff_capabilities_role_check CHECK (role = ANY (ARRAY['moderator'::text, 'governor'::text, 'admin'::text]))
);
alter table private.staff_capabilities owner to postgres;
alter table private.staff_capabilities enable row level security;
revoke all on private.staff_capabilities from public;
