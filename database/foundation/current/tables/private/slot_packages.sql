-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.slot_packages (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  term_days integer not null,
  slot_count integer not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint slot_packages_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint slot_packages_pkey PRIMARY KEY (id),
  constraint slot_packages_slot_count_check CHECK (slot_count >= 5 AND slot_count <= 250),
  constraint slot_packages_term_days_check CHECK (term_days = ANY (ARRAY[30, 90, 180]))
);
alter table private.slot_packages owner to postgres;
alter table private.slot_packages enable row level security;
CREATE INDEX slot_packages_owner_idx ON private.slot_packages USING btree (owner_id, created_at);
CREATE TRIGGER slot_packages_immutable BEFORE UPDATE ON private.slot_packages FOR EACH ROW EXECUTE FUNCTION internal.slot_package_guard();
revoke all on private.slot_packages from public;
