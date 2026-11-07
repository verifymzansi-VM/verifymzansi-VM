-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_business_checks (
  id uuid not null,
  business_id uuid not null,
  owner_id uuid not null,
  kind text not null,
  status text default 'pending'::text not null,
  seen_method text,
  visit_address text,
  available_slots text[],
  screenshots_consent_at timestamp with time zone,
  assigned_to uuid,
  scheduled_for timestamp with time zone,
  visit_report jsonb,
  report_by uuid,
  report_at timestamp with time zone,
  reviewed_by uuid,
  review_note text,
  reason_code text,
  public_city text,
  decided_at timestamp with time zone,
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone default clock_timestamp() not null,
  updated_at timestamp with time zone default clock_timestamp() not null,
  constraint frontend_business_checks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_business_checks_business_id_fkey FOREIGN KEY (business_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint frontend_business_checks_check CHECK (kind <> 'seen'::text OR seen_method IS NOT NULL AND screenshots_consent_at IS NOT NULL AND available_slots IS NOT NULL AND cardinality(available_slots) >= 1 AND cardinality(available_slots) <= 3),
  constraint frontend_business_checks_check1 CHECK (seen_method <> 'visit'::text OR visit_address IS NOT NULL),
  constraint frontend_business_checks_check2 CHECK ((status = ANY (ARRAY['pending'::text, 'info_requested'::text])) = (decided_at IS NULL)),
  constraint frontend_business_checks_check3 CHECK ((status = 'approved'::text) = (expires_at IS NOT NULL)),
  constraint frontend_business_checks_check4 CHECK (revoked_at IS NULL OR status = 'withdrawn'::text),
  constraint frontend_business_checks_check5 CHECK (expires_at IS NULL OR expires_at > decided_at),
  constraint frontend_business_checks_id_owner_id_fkey FOREIGN KEY (id, owner_id) REFERENCES private.evidence_cases(id, subject_id) ON DELETE CASCADE,
  constraint frontend_business_checks_kind_check CHECK (kind = ANY (ARRAY['seen'::text, 'cipc'::text, 'cipc_link'::text])),
  constraint frontend_business_checks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint frontend_business_checks_pkey PRIMARY KEY (id),
  constraint frontend_business_checks_public_city_check CHECK (length(public_city) >= 1 AND length(public_city) <= 80),
  constraint frontend_business_checks_reason_code_check CHECK (length(reason_code) >= 1 AND length(reason_code) <= 80),
  constraint frontend_business_checks_report_by_fkey FOREIGN KEY (report_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_business_checks_review_note_check CHECK (length(review_note) >= 1 AND length(review_note) <= 1000),
  constraint frontend_business_checks_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_business_checks_seen_method_check CHECK (seen_method = ANY (ARRAY['video'::text, 'visit'::text])),
  constraint frontend_business_checks_status_check CHECK (status = ANY (ARRAY['pending'::text, 'info_requested'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text])),
  constraint frontend_business_checks_visit_address_check CHECK (length(visit_address) >= 5 AND length(visit_address) <= 300),
  constraint frontend_business_checks_visit_report_check CHECK (visit_report IS NULL OR jsonb_typeof(visit_report) = 'object'::text)
);
alter table private.frontend_business_checks owner to postgres;
alter table private.frontend_business_checks enable row level security;
CREATE INDEX frontend_business_checks_business_idx ON private.frontend_business_checks USING btree (business_id, created_at DESC);
CREATE UNIQUE INDEX frontend_business_checks_cipc_open_idx ON private.frontend_business_checks USING btree (business_id) WHERE ((kind = ANY (ARRAY['cipc'::text, 'cipc_link'::text])) AND (status = ANY (ARRAY['pending'::text, 'info_requested'::text])));
CREATE UNIQUE INDEX frontend_business_checks_open_idx ON private.frontend_business_checks USING btree (business_id, kind) WHERE (status = ANY (ARRAY['pending'::text, 'info_requested'::text]));
CREATE INDEX frontend_business_checks_owner_idx ON private.frontend_business_checks USING btree (owner_id);
CREATE INDEX frontend_business_checks_reporter_idx ON private.frontend_business_checks USING btree (report_by);
CREATE INDEX frontend_business_checks_reviewer_idx ON private.frontend_business_checks USING btree (reviewed_by);
CREATE INDEX frontend_business_checks_verifier_idx ON private.frontend_business_checks USING btree (assigned_to);
CREATE TRIGGER close_deleted_frontend_business_check AFTER DELETE ON private.frontend_business_checks FOR EACH ROW EXECUTE FUNCTION internal.close_deleted_frontend_business_check();
CREATE TRIGGER notify_frontend_business_outcome AFTER UPDATE OF status, scheduled_for ON private.frontend_business_checks FOR EACH ROW EXECUTE FUNCTION internal.notify_frontend_business_check();
revoke all on private.frontend_business_checks from public;
