-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.legal_holds (
  id uuid default gen_random_uuid() not null,
  subject_id uuid not null,
  reason text not null,
  placed_by uuid not null,
  placed_at timestamp with time zone default statement_timestamp() not null,
  released_by uuid,
  released_at timestamp with time zone,
  constraint legal_holds_check CHECK ((released_at IS NULL) = (released_by IS NULL)),
  constraint legal_holds_pkey PRIMARY KEY (id),
  constraint legal_holds_placed_by_fkey FOREIGN KEY (placed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint legal_holds_reason_check CHECK (length(reason) >= 5 AND length(reason) <= 500),
  constraint legal_holds_released_by_fkey FOREIGN KEY (released_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint legal_holds_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES auth.users(id) ON DELETE RESTRICT
);
alter table private.legal_holds owner to postgres;
alter table private.legal_holds enable row level security;
CREATE INDEX legal_holds_active_idx ON private.legal_holds USING btree (subject_id) WHERE (released_at IS NULL);
CREATE TRIGGER evidence_deletion_legal_hold BEFORE INSERT ON private.legal_holds FOR EACH ROW EXECUTE FUNCTION internal.evidence_deletion_hold_guard();
revoke all on private.legal_holds from public;
