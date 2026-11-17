-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.staff_roles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  role text not null,
  granted_by uuid,
  granted_at timestamp with time zone default statement_timestamp() not null,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  frontend_mfa_not_before timestamp with time zone,
  constraint staff_roles_check CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  constraint staff_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint staff_roles_pkey PRIMARY KEY (id),
  constraint staff_roles_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint staff_roles_role_check CHECK (role = ANY (ARRAY['moderator'::text, 'governor'::text, 'admin'::text])),
  constraint staff_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT
);
alter table private.staff_roles owner to postgres;
alter table private.staff_roles enable row level security;
CREATE INDEX staff_roles_granted_by_idx ON private.staff_roles USING btree (granted_by) WHERE (granted_by IS NOT NULL);
CREATE UNIQUE INDEX staff_roles_one_active_idx ON private.staff_roles USING btree (user_id) WHERE (revoked_at IS NULL);
CREATE INDEX staff_roles_revoked_by_idx ON private.staff_roles USING btree (revoked_by) WHERE (revoked_by IS NOT NULL);
CREATE INDEX staff_roles_user_id_idx ON private.staff_roles USING btree (user_id);
CREATE TRIGGER staff_last_admin BEFORE UPDATE ON private.staff_roles FOR EACH ROW EXECUTE FUNCTION internal.staff_last_admin_guard();
CREATE TRIGGER staff_roles_release_queue_claims AFTER UPDATE OF revoked_at, role ON private.staff_roles FOR EACH ROW EXECUTE FUNCTION internal.release_queue_claims_on_revocation();
revoke all on private.staff_roles from public;
