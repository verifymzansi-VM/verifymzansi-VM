-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.privacy_requests (
  id uuid default gen_random_uuid() not null,
  type text not null,
  subject_user_id uuid,
  requester_email text not null,
  requester_phone text default 'not_provided'::text not null,
  description text not null,
  identity_check text not null,
  identity_verified boolean default false not null,
  verified_at timestamp with time zone,
  verified_by uuid,
  intake_by uuid,
  assigned_to uuid,
  processed_by uuid,
  status text default 'submitted'::text not null,
  received_at timestamp with time zone not null,
  due_by timestamp with time zone not null,
  legal_basis text not null,
  extended_due_at timestamp with time zone,
  extension_reason text,
  extension_notified_at timestamp with time zone,
  effective_due_at timestamp with time zone generated always as (COALESCE(extended_due_at, due_by)) stored,
  response_summary text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default clock_timestamp() not null,
  revision integer default 1 not null,
  constraint privacy_requests_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint privacy_requests_check CHECK (due_by > received_at),
  constraint privacy_requests_check1 CHECK (extended_due_at > due_by),
  constraint privacy_requests_check2 CHECK (identity_verified = (verified_at IS NOT NULL)),
  constraint privacy_requests_check3 CHECK ((status = 'completed'::text) = (completed_at IS NOT NULL)),
  constraint privacy_requests_check4 CHECK ((extended_due_at IS NULL) = (extension_reason IS NULL)),
  constraint privacy_requests_description_check CHECK (length(description) >= 2 AND length(description) <= 3400),
  constraint privacy_requests_extension_reason_check CHECK (length(extension_reason) >= 10 AND length(extension_reason) <= 1000),
  constraint privacy_requests_identity_check_check CHECK (identity_check = ANY (ARRAY['session'::text, 'manual'::text])),
  constraint privacy_requests_intake_by_fkey FOREIGN KEY (intake_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint privacy_requests_pkey PRIMARY KEY (id),
  constraint privacy_requests_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint privacy_requests_requester_email_check CHECK (length(requester_email) >= 3 AND length(requester_email) <= 254),
  constraint privacy_requests_requester_phone_check CHECK (length(requester_phone) >= 1 AND length(requester_phone) <= 30),
  constraint privacy_requests_response_summary_check CHECK (length(response_summary) >= 1 AND length(response_summary) <= 4200),
  constraint privacy_requests_revision_check CHECK (revision > 0),
  constraint privacy_requests_status_check CHECK (status = ANY (ARRAY['submitted'::text, 'identity_pending'::text, 'in_progress'::text, 'completed'::text, 'rejected'::text])),
  constraint privacy_requests_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint privacy_requests_type_fkey FOREIGN KEY (type) REFERENCES private.privacy_request_rules(request_type),
  constraint privacy_requests_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL
);
alter table private.privacy_requests owner to postgres;
alter table private.privacy_requests enable row level security;
CREATE INDEX privacy_requests_assignee_idx ON private.privacy_requests USING btree (assigned_to);
CREATE INDEX privacy_requests_closed_idx ON private.privacy_requests USING btree (created_at DESC, id) WHERE (status = ANY (ARRAY['completed'::text, 'rejected'::text]));
CREATE INDEX privacy_requests_intake_idx ON private.privacy_requests USING btree (intake_by);
CREATE INDEX privacy_requests_open_idx ON private.privacy_requests USING btree (effective_due_at, id) WHERE (status = ANY (ARRAY['submitted'::text, 'identity_pending'::text, 'in_progress'::text]));
CREATE INDEX privacy_requests_processor_idx ON private.privacy_requests USING btree (processed_by);
CREATE INDEX privacy_requests_subject_idx ON private.privacy_requests USING btree (subject_user_id, created_at DESC);
CREATE INDEX privacy_requests_type_idx ON private.privacy_requests USING btree (type);
CREATE INDEX privacy_requests_verifier_idx ON private.privacy_requests USING btree (verified_by);
revoke all on private.privacy_requests from public;
