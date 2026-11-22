-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.identity_disclosures (
  id uuid default gen_random_uuid() not null,
  number bigint generated always as identity not null,
  opened_by uuid not null,
  opened_at timestamp with time zone not null,
  closes_at timestamp with time zone not null,
  request_type text not null,
  request_reference text not null,
  reason text not null,
  attested boolean not null,
  lookup_kind text not null,
  lookup_value text not null,
  outcome text not null,
  subject_ids uuid[] default '{}'::uuid[] not null,
  match_count integer not null,
  issued_by text,
  confirmed_number text,
  confirmed_by text,
  constraint identity_disclosures_attested_check CHECK (attested),
  constraint identity_disclosures_closes_check CHECK (closes_at = (opened_at + '00:15:00'::interval)),
  constraint identity_disclosures_confirmation_check CHECK (
CASE
    WHEN issued_by IS NULL AND confirmed_number IS NULL AND confirmed_by IS NULL THEN request_type = ANY (ARRAY['subpoena'::text, 'court_order'::text, 'warrant'::text, 'police_case'::text, 'regulator'::text])
    ELSE COALESCE((request_type = ANY (ARRAY['subpoena'::text, 'court_order'::text, 'search_warrant'::text, 'urgent_life_risk'::text])) AND length(issued_by) >= 3 AND length(issued_by) <= 120 AND length(confirmed_by) >= 3 AND length(confirmed_by) <= 120 AND confirmed_number ~ '^[+]?[0-9][0-9 ]{3,18}[0-9]$'::text, false)
END),
  constraint identity_disclosures_lookup_kind_check CHECK (lookup_kind = ANY (ARRAY['post'::text, 'id_number'::text, 'phone'::text, 'email'::text])),
  constraint identity_disclosures_lookup_value_check CHECK (length(lookup_value) >= 3 AND length(lookup_value) <= 254),
  constraint identity_disclosures_match_count_check CHECK (match_count >= cardinality(subject_ids)),
  constraint identity_disclosures_number_key UNIQUE (number),
  constraint identity_disclosures_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint identity_disclosures_outcome_check CHECK (outcome = ANY (ARRAY['record'::text, 'no_record'::text, 'attempt_only'::text, 'no_match'::text])),
  constraint identity_disclosures_pkey PRIMARY KEY (id),
  constraint identity_disclosures_reason_check CHECK (length(reason) >= 10 AND length(reason) <= 2000),
  constraint identity_disclosures_reference_check CHECK (length(request_reference) >= 3 AND length(request_reference) <= 100),
  constraint identity_disclosures_request_type_check CHECK (request_type = ANY (ARRAY['subpoena'::text, 'court_order'::text, 'warrant'::text, 'police_case'::text, 'regulator'::text, 'search_warrant'::text, 'urgent_life_risk'::text])),
  constraint identity_disclosures_subjects_check CHECK (cardinality(subject_ids) <= 5 AND (outcome = 'no_match'::text) = (cardinality(subject_ids) = 0) AND (outcome <> 'attempt_only'::text OR lookup_kind = 'id_number'::text))
);
alter table private.identity_disclosures owner to postgres;
alter table private.identity_disclosures enable row level security;
CREATE INDEX identity_disclosures_opened_at_idx ON private.identity_disclosures USING btree (opened_at DESC, id DESC);
CREATE INDEX identity_disclosures_opened_by_idx ON private.identity_disclosures USING btree (opened_by, opened_at DESC);
CREATE TRIGGER identity_disclosures_append_only BEFORE DELETE OR UPDATE ON private.identity_disclosures FOR EACH ROW EXECUTE FUNCTION internal.append_only_guard();
CREATE TRIGGER identity_disclosures_no_truncate BEFORE TRUNCATE ON private.identity_disclosures FOR EACH STATEMENT EXECUTE FUNCTION internal.append_only_guard();
revoke all on private.identity_disclosures from public;
comment on table private.identity_disclosures is 'Authority requests: one append-only row per opening of a member''s kept identity record by a governor or admin, written before anything is shown; a search that finds nobody is logged too. Closes 15 minutes after opening.';
