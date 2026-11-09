-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.decisions (
  id uuid default gen_random_uuid() not null,
  case_id uuid not null,
  action text not null,
  payload jsonb not null,
  case_version integer not null,
  reviewed_snapshot jsonb not null,
  proposed_by uuid not null,
  proposed_at timestamp with time zone default statement_timestamp() not null,
  approved_by uuid,
  approved_at timestamp with time zone,
  withdrawn_by uuid,
  withdrawn_at timestamp with time zone,
  withdrawn_case_version integer,
  withdrawal_reason text,
  status text default 'proposed'::text not null,
  scope_kind text default 'native'::text not null,
  suspension_days integer,
  constraint decisions_action_check CHECK (action = ANY (ARRAY['approve_override'::text, 'reject'::text, 'restrict_account'::text])),
  constraint decisions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint decisions_case_id_fkey FOREIGN KEY (case_id) REFERENCES private.evidence_cases(id) ON DELETE RESTRICT,
  constraint decisions_case_version_check CHECK (case_version > 0),
  constraint decisions_check CHECK (status = 'approved'::text AND approved_by IS NOT NULL AND approved_at IS NOT NULL OR status <> 'approved'::text AND approved_by IS NULL AND approved_at IS NULL),
  constraint decisions_check1 CHECK (status = 'withdrawn'::text AND withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL AND withdrawn_case_version IS NOT NULL AND withdrawal_reason IS NOT NULL OR status <> 'withdrawn'::text AND withdrawn_by IS NULL AND withdrawn_at IS NULL AND withdrawn_case_version IS NULL AND withdrawal_reason IS NULL),
  constraint decisions_check2 CHECK (approved_by IS DISTINCT FROM proposed_by),
  constraint decisions_check3 CHECK ((scope_kind = 'report_suspension'::text) = (suspension_days IS NOT NULL)),
  constraint decisions_check4 CHECK (scope_kind = 'native'::text OR action = 'restrict_account'::text),
  constraint decisions_payload_check CHECK (jsonb_typeof(payload) = 'object'::text AND octet_length(payload::text) <= 2048),
  constraint decisions_pkey PRIMARY KEY (id),
  constraint decisions_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint decisions_reviewed_snapshot_check CHECK (jsonb_typeof(reviewed_snapshot) = 'array'::text),
  constraint decisions_scope_kind_check CHECK (scope_kind = ANY (ARRAY['native'::text, 'report_suspension'::text, 'report_ban'::text])),
  constraint decisions_status_check CHECK (status = ANY (ARRAY['proposed'::text, 'approved'::text, 'withdrawn'::text])),
  constraint decisions_suspension_days_check CHECK (suspension_days >= 1 AND suspension_days <= 30),
  constraint decisions_withdrawn_by_fkey FOREIGN KEY (withdrawn_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint decisions_withdrawn_case_version_check CHECK (withdrawn_case_version > 0)
);
alter table private.decisions owner to postgres;
alter table private.decisions enable row level security;
CREATE INDEX decisions_approved_restriction_idx ON private.decisions USING btree (case_id) WHERE ((status = 'approved'::text) AND (action = 'restrict_account'::text));
CREATE INDEX decisions_case_lookup_idx ON private.decisions USING btree (case_id, id);
CREATE UNIQUE INDEX decisions_one_open_idx ON private.decisions USING btree (case_id) WHERE (status = 'proposed'::text);
CREATE INDEX decisions_staff_page_idx ON private.decisions USING btree (status, proposed_at DESC, id DESC);
CREATE TRIGGER bind_native_restriction_for_review AFTER UPDATE OF status ON private.decisions FOR EACH ROW WHEN (old.status = 'proposed'::text AND new.status = 'approved'::text AND new.scope_kind = 'native'::text AND new.action = 'restrict_account'::text) EXECUTE FUNCTION internal.bind_native_restriction_for_review();
CREATE TRIGGER decision_binding BEFORE DELETE OR UPDATE ON private.decisions FOR EACH ROW EXECUTE FUNCTION internal.decision_binding_guard();
CREATE TRIGGER frontend_report_restriction_effect AFTER UPDATE OF status ON private.decisions FOR EACH ROW WHEN (old.status = 'proposed'::text AND (new.status = ANY (ARRAY['approved'::text, 'withdrawn'::text]))) EXECUTE FUNCTION internal.frontend_report_restriction_effect();
CREATE TRIGGER verification_decision_effect AFTER UPDATE OF status ON private.decisions FOR EACH ROW WHEN (new.status = 'approved'::text AND old.status = 'proposed'::text) EXECUTE FUNCTION internal.verification_decision_effect();
CREATE TRIGGER verification_decision_proposal_binding BEFORE INSERT ON private.decisions FOR EACH ROW EXECUTE FUNCTION internal.verification_decision_proposal_binding();
revoke all on private.decisions from public;
