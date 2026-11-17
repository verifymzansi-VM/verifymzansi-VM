-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_cipc_reviews (
  check_id uuid not null,
  registration_number text not null,
  route text not null,
  submitted_at timestamp with time zone,
  owner_file uuid,
  official_file uuid,
  prior_check uuid,
  linked_business_id uuid,
  renewal boolean default false not null,
  use_registered_office boolean default false not null,
  display_full_office boolean default false not null,
  office_override jsonb,
  registered_name text,
  accepted_role text,
  position_title text,
  registered_office jsonb,
  representative_email text,
  representative_position text,
  representative_verified_at timestamp with time zone,
  domain_confirmed boolean default false not null,
  callback_confirmed boolean default false not null,
  callback_record jsonb,
  constraint frontend_cipc_reviews_accepted_role_check CHECK (accepted_role = ANY (ARRAY['director'::text, 'member'::text, 'representative'::text])),
  constraint frontend_cipc_reviews_callback_record_check CHECK (callback_record IS NULL OR jsonb_typeof(callback_record) = 'object'::text),
  constraint frontend_cipc_reviews_check_id_fkey FOREIGN KEY (check_id) REFERENCES private.frontend_business_checks(id) ON DELETE CASCADE,
  constraint frontend_cipc_reviews_linked_business_id_fkey FOREIGN KEY (linked_business_id) REFERENCES private.posts(id) ON DELETE SET NULL,
  constraint frontend_cipc_reviews_office_override_check CHECK (office_override IS NULL OR jsonb_typeof(office_override) = 'object'::text),
  constraint frontend_cipc_reviews_official_file_fkey FOREIGN KEY (official_file) REFERENCES private.evidence_artifacts(id) ON DELETE SET NULL,
  constraint frontend_cipc_reviews_owner_file_fkey FOREIGN KEY (owner_file) REFERENCES private.evidence_artifacts(id) ON DELETE SET NULL,
  constraint frontend_cipc_reviews_pkey PRIMARY KEY (check_id),
  constraint frontend_cipc_reviews_position_title_check CHECK (length(position_title) >= 1 AND length(position_title) <= 120),
  constraint frontend_cipc_reviews_prior_check_fkey FOREIGN KEY (prior_check) REFERENCES private.frontend_business_checks(id) ON DELETE SET NULL,
  constraint frontend_cipc_reviews_registered_name_check CHECK (length(registered_name) >= 2 AND length(registered_name) <= 250),
  constraint frontend_cipc_reviews_registered_office_check CHECK (registered_office IS NULL OR jsonb_typeof(registered_office) = 'object'::text),
  constraint frontend_cipc_reviews_registration_number_check CHECK (registration_number ~ '^[0-9]{4}/[0-9]{6}/[0-9]{2}$'::text),
  constraint frontend_cipc_reviews_representative_email_check CHECK (length(representative_email) >= 3 AND length(representative_email) <= 254),
  constraint frontend_cipc_reviews_representative_position_check CHECK (length(representative_position) >= 2 AND length(representative_position) <= 40),
  constraint frontend_cipc_reviews_route_check CHECK (route = ANY (ARRAY['director'::text, 'representative'::text]))
);
alter table private.frontend_cipc_reviews owner to postgres;
alter table private.frontend_cipc_reviews enable row level security;
CREATE INDEX frontend_cipc_linked_business_idx ON private.frontend_cipc_reviews USING btree (linked_business_id);
CREATE INDEX frontend_cipc_official_file_idx ON private.frontend_cipc_reviews USING btree (official_file);
CREATE INDEX frontend_cipc_owner_file_idx ON private.frontend_cipc_reviews USING btree (owner_file);
CREATE INDEX frontend_cipc_prior_idx ON private.frontend_cipc_reviews USING btree (prior_check);
CREATE INDEX frontend_cipc_registration_idx ON private.frontend_cipc_reviews USING btree (registration_number, check_id);
revoke all on private.frontend_cipc_reviews from public;
