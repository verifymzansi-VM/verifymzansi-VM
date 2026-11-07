-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.organisation_applications (
  id uuid default gen_random_uuid() not null,
  organisation_id uuid not null,
  programme_id uuid,
  post_id uuid not null,
  post_kind text default 'business'::text not null,
  applicant_id uuid not null,
  reason text,
  member_reference text,
  share_representative_name boolean not null,
  consented_at timestamp with time zone not null,
  status text default 'submitted'::text not null,
  info_request text,
  info_response text,
  decision_by uuid,
  decision_at timestamp with time zone,
  decision_note text,
  created_at timestamp with time zone default statement_timestamp() not null,
  updated_at timestamp with time zone default statement_timestamp() not null,
  constraint organisation_applications_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint organisation_applications_decision_note_check CHECK (decision_note IS NULL OR internal.plain_text_valid(decision_note, 1, 1000, true)),
  constraint organisation_applications_info_request_check CHECK (info_request IS NULL OR internal.plain_text_valid(info_request, 5, 1000, true)),
  constraint organisation_applications_info_response_check CHECK (info_response IS NULL OR internal.plain_text_valid(info_response, 2, 2000, true)),
  constraint organisation_applications_member_reference_check CHECK (member_reference IS NULL OR internal.plain_text_valid(member_reference, 1, 120, false)),
  constraint organisation_applications_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE CASCADE,
  constraint organisation_applications_pkey PRIMARY KEY (id),
  constraint organisation_applications_post_id_post_kind_fkey FOREIGN KEY (post_id, post_kind) REFERENCES private.posts(id, kind) ON DELETE CASCADE,
  constraint organisation_applications_post_kind_check CHECK (post_kind = 'business'::text),
  constraint organisation_applications_programme_id_organisation_id_fkey FOREIGN KEY (programme_id, organisation_id) REFERENCES private.organisation_programmes(id, organisation_id),
  constraint organisation_applications_reason_check CHECK (reason IS NULL OR internal.plain_text_valid(reason, 2, 1000, true)),
  constraint organisation_applications_status_check CHECK (status = ANY (ARRAY['submitted'::text, 'more_info_required'::text, 'approved'::text, 'declined'::text, 'withdrawn'::text]))
);
alter table private.organisation_applications owner to postgres;
alter table private.organisation_applications enable row level security;
CREATE INDEX organisation_applications_applicant_idx ON private.organisation_applications USING btree (applicant_id, created_at);
CREATE UNIQUE INDEX organisation_applications_open_idx ON private.organisation_applications USING btree (organisation_id, post_id) WHERE (status = ANY (ARRAY['submitted'::text, 'more_info_required'::text]));
CREATE INDEX organisation_applications_org_idx ON private.organisation_applications USING btree (organisation_id, created_at DESC, id DESC);
CREATE INDEX organisation_applications_post_idx ON private.organisation_applications USING btree (post_id);
revoke all on private.organisation_applications from public;
