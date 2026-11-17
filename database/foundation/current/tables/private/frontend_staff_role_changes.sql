-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_staff_role_changes (
  id uuid default gen_random_uuid() not null,
  target_id uuid not null,
  prior_assignment_id uuid,
  from_role text not null,
  to_role text not null,
  proposer_id uuid,
  reviewer_id uuid,
  reason text not null,
  note text,
  status text default 'proposed'::text not null,
  direct_removal boolean default false not null,
  created_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  decided_at timestamp with time zone,
  constraint frontend_staff_role_changes_check CHECK ((to_role = ANY (ARRAY['member'::text, 'moderator'::text, 'governor'::text, 'admin'::text])) AND to_role <> from_role),
  constraint frontend_staff_role_changes_check1 CHECK (NOT direct_removal OR status = 'applied'::text),
  constraint frontend_staff_role_changes_check2 CHECK (expires_at > created_at),
  constraint frontend_staff_role_changes_check3 CHECK ((status = 'proposed'::text) = (decided_at IS NULL)),
  constraint frontend_staff_role_changes_from_role_check CHECK (from_role = ANY (ARRAY['member'::text, 'moderator'::text, 'governor'::text, 'admin'::text])),
  constraint frontend_staff_role_changes_note_check CHECK (length(note) >= 1 AND length(note) <= 500),
  constraint frontend_staff_role_changes_pkey PRIMARY KEY (id),
  constraint frontend_staff_role_changes_prior_assignment_id_fkey FOREIGN KEY (prior_assignment_id) REFERENCES private.staff_roles(id) ON DELETE SET NULL,
  constraint frontend_staff_role_changes_proposer_id_fkey FOREIGN KEY (proposer_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_staff_role_changes_reason_check CHECK (length(reason) >= 5 AND length(reason) <= 500),
  constraint frontend_staff_role_changes_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_staff_role_changes_status_check CHECK (status = ANY (ARRAY['proposed'::text, 'applied'::text, 'rejected'::text, 'withdrawn'::text])),
  constraint frontend_staff_role_changes_target_id_fkey FOREIGN KEY (target_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table private.frontend_staff_role_changes owner to postgres;
alter table private.frontend_staff_role_changes enable row level security;
CREATE INDEX frontend_staff_role_changes_assignment_idx ON private.frontend_staff_role_changes USING btree (prior_assignment_id);
CREATE INDEX frontend_staff_role_changes_history_idx ON private.frontend_staff_role_changes USING btree (decided_at DESC, id DESC) WHERE (status = 'applied'::text);
CREATE UNIQUE INDEX frontend_staff_role_changes_pending_idx ON private.frontend_staff_role_changes USING btree (target_id) WHERE (status = 'proposed'::text);
CREATE INDEX frontend_staff_role_changes_proposer_idx ON private.frontend_staff_role_changes USING btree (proposer_id);
CREATE INDEX frontend_staff_role_changes_reviewer_idx ON private.frontend_staff_role_changes USING btree (reviewer_id);
CREATE INDEX frontend_staff_role_changes_target_idx ON private.frontend_staff_role_changes USING btree (target_id);
revoke all on private.frontend_staff_role_changes from public;
