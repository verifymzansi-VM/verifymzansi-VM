-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.reports (
  id uuid default gen_random_uuid() not null,
  post_id uuid,
  subject_account_id uuid not null,
  category text not null,
  severity text default 'standard'::text not null,
  description text not null,
  reporter_id uuid,
  reporter_ip_hmac text,
  status text default 'open'::text not null,
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default statement_timestamp() not null,
  report_origin text default 'public'::text not null,
  duplicate_post_a uuid,
  duplicate_post_b uuid,
  duplicate_revision_a integer,
  duplicate_revision_b integer,
  duplicate_owner_b uuid,
  duplicate_created_by uuid,
  frontend_reason text,
  revision integer default 1 not null,
  frontend_area text,
  active_proposal_id uuid,
  constraint reports_active_proposal_id_fkey FOREIGN KEY (active_proposal_id) REFERENCES private.decisions(id) ON DELETE SET NULL,
  constraint reports_category_check CHECK (category = ANY (ARRAY['scam'::text, 'prohibited_item'::text, 'impersonation'::text, 'harassment'::text, 'misleading_info'::text, 'duplicate_event'::text])),
  constraint reports_check CHECK ((status = 'open'::text) = (resolved_at IS NULL)),
  constraint reports_check1 CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
  constraint reports_check2 CHECK ((resolved_at IS NULL) = (resolution_note IS NULL)),
  constraint reports_description_check CHECK (length(description) >= 10 AND length(description) <= 2000),
  constraint reports_frontend_area_check CHECK (frontend_area IS NULL OR (frontend_area = ANY (ARRAY['market'::text, 'business'::text, 'tourism_events'::text]))),
  constraint reports_frontend_reason_check CHECK (frontend_reason IS NULL OR (frontend_reason = ANY (ARRAY['scam'::text, 'misleading'::text, 'expired'::text, 'fake_listing'::text, 'prohibited_item'::text, 'harassment'::text, 'impersonation'::text, 'spam'::text, 'other'::text]))),
  constraint reports_origin_shape CHECK (report_origin = 'public'::text AND (category = ANY (ARRAY['scam'::text, 'prohibited_item'::text, 'impersonation'::text, 'harassment'::text, 'misleading_info'::text])) AND reporter_ip_hmac IS NOT NULL AND num_nonnulls(duplicate_post_a, duplicate_post_b, duplicate_revision_a, duplicate_revision_b, duplicate_owner_b, duplicate_created_by) = 0 OR report_origin = 'staff'::text AND category = 'duplicate_event'::text AND reporter_ip_hmac IS NULL AND (reporter_id IS NULL OR reporter_id = duplicate_created_by) AND num_nonnulls(duplicate_post_a, duplicate_post_b, duplicate_revision_a, duplicate_revision_b, duplicate_owner_b, duplicate_created_by) = 6 AND duplicate_post_a < duplicate_post_b AND duplicate_revision_a > 0 AND duplicate_revision_b > 0 AND (post_id IS NULL OR post_id = duplicate_post_a)),
  constraint reports_pkey PRIMARY KEY (id),
  constraint reports_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE SET NULL,
  constraint reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint reports_reporter_ip_hmac_check CHECK (reporter_ip_hmac ~ '^[A-Za-z0-9_-]{43}$'::text),
  constraint reports_resolution_note_check CHECK (resolution_note IS NULL OR length(resolution_note) >= 5 AND length(resolution_note) <= 500),
  constraint reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint reports_revision_check CHECK (revision > 0),
  constraint reports_severity_check CHECK (severity = ANY (ARRAY['high'::text, 'standard'::text])),
  constraint reports_status_check CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text])),
  constraint reports_subject_account_id_fkey FOREIGN KEY (subject_account_id) REFERENCES auth.users(id) ON DELETE RESTRICT
);
alter table private.reports owner to postgres;
alter table private.reports enable row level security;
CREATE INDEX reports_active_proposal_idx ON private.reports USING btree (active_proposal_id) WHERE (active_proposal_id IS NOT NULL);
CREATE INDEX reports_frontend_area_idx ON private.reports USING btree (frontend_area, status, created_at);
CREATE UNIQUE INDEX reports_one_open_anonymous_idx ON private.reports USING btree (post_id, reporter_ip_hmac) WHERE ((report_origin = 'public'::text) AND (status = 'open'::text) AND (reporter_id IS NULL));
CREATE UNIQUE INDEX reports_one_open_duplicate_pair_idx ON private.reports USING btree (duplicate_post_a, duplicate_post_b) WHERE ((report_origin = 'staff'::text) AND (status = 'open'::text));
CREATE UNIQUE INDEX reports_one_open_signed_in_idx ON private.reports USING btree (post_id, reporter_id) WHERE ((report_origin = 'public'::text) AND (status = 'open'::text) AND (reporter_id IS NOT NULL));
CREATE INDEX reports_open_idx ON private.reports USING btree (severity, created_at) WHERE (status = 'open'::text);
CREATE INDEX reports_open_post_idx ON private.reports USING btree (post_id) WHERE (status = 'open'::text);
CREATE INDEX reports_post_id_idx ON private.reports USING btree (post_id) WHERE (post_id IS NOT NULL);
CREATE INDEX reports_reporter_id_idx ON private.reports USING btree (reporter_id) WHERE (reporter_id IS NOT NULL);
CREATE INDEX reports_resolved_by_idx ON private.reports USING btree (resolved_by) WHERE (resolved_by IS NOT NULL);
CREATE INDEX reports_subject_idx ON private.reports USING btree (subject_account_id, status);
CREATE TRIGGER frontend_report_record_guard BEFORE INSERT OR UPDATE ON private.reports FOR EACH ROW EXECUTE FUNCTION internal.frontend_report_record_guard();
CREATE TRIGGER reports_identity BEFORE UPDATE ON private.reports FOR EACH ROW EXECUTE FUNCTION internal.report_identity_guard();
revoke all on private.reports from public;
