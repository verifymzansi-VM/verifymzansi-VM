-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.entitlement_members (
  entitlement_id uuid not null,
  member_id uuid not null,
  added_by uuid not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint entitlement_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint entitlement_members_entitlement_id_fkey FOREIGN KEY (entitlement_id) REFERENCES private.entitlements(id) ON DELETE CASCADE,
  constraint entitlement_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint entitlement_members_pkey PRIMARY KEY (entitlement_id, member_id)
);
alter table private.entitlement_members owner to postgres;
alter table private.entitlement_members enable row level security;
CREATE INDEX entitlement_members_member_idx ON private.entitlement_members USING btree (member_id, entitlement_id);
revoke all on private.entitlement_members from public;
