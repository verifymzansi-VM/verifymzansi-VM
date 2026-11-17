-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.organisation_sponsorships (
  id uuid default gen_random_uuid() not null,
  organisation_id uuid not null,
  affiliation_id uuid not null,
  post_id uuid not null,
  owner_id uuid not null,
  sponsor_type text not null,
  status text default 'waitlisted'::text not null,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  entitlement_id uuid,
  requested_by uuid not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  ended_at timestamp with time zone,
  ended_by uuid,
  end_reason text,
  constraint organisation_sponsorships_affiliation_id_fkey FOREIGN KEY (affiliation_id) REFERENCES private.organisation_affiliations(id) ON DELETE CASCADE,
  constraint organisation_sponsorships_check CHECK (
CASE status
    WHEN 'waitlisted'::text THEN entitlement_id IS NULL AND starts_at IS NULL AND ends_at IS NULL AND ended_at IS NULL
    WHEN 'active'::text THEN entitlement_id IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at AND ended_at IS NULL AND end_reason IS NULL
    ELSE ended_at IS NOT NULL AND end_reason IS NOT NULL
END),
  constraint organisation_sponsorships_end_reason_check CHECK (end_reason IS NULL OR internal.plain_text_valid(end_reason, 5, 500, true)),
  constraint organisation_sponsorships_entitlement_id_fkey FOREIGN KEY (entitlement_id) REFERENCES private.entitlements(id) ON DELETE RESTRICT,
  constraint organisation_sponsorships_entitlement_id_key UNIQUE (entitlement_id),
  constraint organisation_sponsorships_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE CASCADE,
  constraint organisation_sponsorships_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint organisation_sponsorships_pkey PRIMARY KEY (id),
  constraint organisation_sponsorships_sponsor_type_check CHECK (sponsor_type = ANY (ARRAY['founding'::text, 'organisation'::text])),
  constraint organisation_sponsorships_status_check CHECK (status = ANY (ARRAY['active'::text, 'waitlisted'::text, 'ended'::text, 'revoked'::text]))
);
alter table private.organisation_sponsorships owner to postgres;
alter table private.organisation_sponsorships enable row level security;
CREATE INDEX organisation_sponsorships_affiliation_id_idx ON private.organisation_sponsorships USING btree (affiliation_id);
CREATE INDEX organisation_sponsorships_due_idx ON private.organisation_sponsorships USING btree (ends_at) WHERE (status = 'active'::text);
CREATE UNIQUE INDEX organisation_sponsorships_open_idx ON private.organisation_sponsorships USING btree (affiliation_id) WHERE (status = ANY (ARRAY['active'::text, 'waitlisted'::text]));
CREATE INDEX organisation_sponsorships_org_idx ON private.organisation_sponsorships USING btree (organisation_id, status, created_at, id);
CREATE INDEX organisation_sponsorships_owner_idx ON private.organisation_sponsorships USING btree (owner_id, created_at DESC);
CREATE INDEX organisation_sponsorships_post_idx ON private.organisation_sponsorships USING btree (post_id) WHERE (status = 'active'::text);
CREATE TRIGGER organisation_sponsorships_delete_release BEFORE DELETE ON private.organisation_sponsorships FOR EACH ROW EXECUTE FUNCTION internal.sponsorship_delete_release();
CREATE TRIGGER organisation_sponsorships_guard BEFORE UPDATE ON private.organisation_sponsorships FOR EACH ROW EXECUTE FUNCTION internal.sponsorship_guard();
revoke all on private.organisation_sponsorships from public;
