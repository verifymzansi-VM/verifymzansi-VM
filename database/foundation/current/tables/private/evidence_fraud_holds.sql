-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.evidence_fraud_holds (
  id uuid default gen_random_uuid() not null,
  case_id uuid not null,
  reason text not null,
  placed_by uuid not null,
  placed_at timestamp with time zone default statement_timestamp() not null,
  closed_by uuid,
  closed_at timestamp with time zone,
  close_reason text,
  constraint evidence_fraud_holds_case_id_fkey FOREIGN KEY (case_id) REFERENCES private.evidence_cases(id) ON DELETE RESTRICT,
  constraint evidence_fraud_holds_check CHECK ((closed_at IS NULL) = (closed_by IS NULL) AND (closed_at IS NULL) = (close_reason IS NULL)),
  constraint evidence_fraud_holds_close_reason_check CHECK (close_reason IS NULL OR length(close_reason) >= 5 AND length(close_reason) <= 500),
  constraint evidence_fraud_holds_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint evidence_fraud_holds_pkey PRIMARY KEY (id),
  constraint evidence_fraud_holds_placed_by_fkey FOREIGN KEY (placed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint evidence_fraud_holds_reason_check CHECK (length(reason) >= 5 AND length(reason) <= 500)
);
alter table private.evidence_fraud_holds owner to postgres;
alter table private.evidence_fraud_holds enable row level security;
CREATE INDEX evidence_fraud_holds_case_idx ON private.evidence_fraud_holds USING btree (case_id, id);
CREATE INDEX evidence_fraud_holds_closed_by_idx ON private.evidence_fraud_holds USING btree (closed_by) WHERE (closed_by IS NOT NULL);
CREATE UNIQUE INDEX evidence_fraud_holds_open_idx ON private.evidence_fraud_holds USING btree (case_id) WHERE (closed_at IS NULL);
CREATE INDEX evidence_fraud_holds_placed_by_idx ON private.evidence_fraud_holds USING btree (placed_by);
CREATE TRIGGER evidence_deletion_fraud_hold BEFORE INSERT ON private.evidence_fraud_holds FOR EACH ROW EXECUTE FUNCTION internal.evidence_deletion_hold_guard();
CREATE TRIGGER evidence_fraud_hold_guard BEFORE UPDATE ON private.evidence_fraud_holds FOR EACH ROW EXECUTE FUNCTION internal.evidence_fraud_hold_guard();
revoke all on private.evidence_fraud_holds from public;
