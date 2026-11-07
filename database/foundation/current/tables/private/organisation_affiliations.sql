-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.organisation_affiliations (
  id uuid default gen_random_uuid() not null,
  organisation_id uuid not null,
  programme_id uuid,
  post_id uuid not null,
  post_kind text default 'business'::text not null,
  application_id uuid,
  affiliation_type text default 'participant'::text not null,
  status text default 'active'::text not null,
  confirmed_at timestamp with time zone default statement_timestamp() not null,
  confirmed_by uuid not null,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint organisation_affiliations_affiliation_type_check CHECK (affiliation_type = ANY (ARRAY['participant'::text, 'member'::text, 'affiliate'::text])),
  constraint organisation_affiliations_application_id_fkey FOREIGN KEY (application_id) REFERENCES private.organisation_applications(id) ON DELETE SET NULL,
  constraint organisation_affiliations_application_id_key UNIQUE (application_id),
  constraint organisation_affiliations_check CHECK ((status = 'active'::text) = (revoked_at IS NULL)),
  constraint organisation_affiliations_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE CASCADE,
  constraint organisation_affiliations_pkey PRIMARY KEY (id),
  constraint organisation_affiliations_post_id_post_kind_fkey FOREIGN KEY (post_id, post_kind) REFERENCES private.posts(id, kind) ON DELETE CASCADE,
  constraint organisation_affiliations_post_kind_check CHECK (post_kind = 'business'::text),
  constraint organisation_affiliations_programme_id_organisation_id_fkey FOREIGN KEY (programme_id, organisation_id) REFERENCES private.organisation_programmes(id, organisation_id),
  constraint organisation_affiliations_revoke_reason_check CHECK (revoke_reason IS NULL OR internal.plain_text_valid(revoke_reason, 5, 500, true)),
  constraint organisation_affiliations_status_check CHECK (status = ANY (ARRAY['active'::text, 'revoked'::text, 'ended'::text]))
);
alter table private.organisation_affiliations owner to postgres;
alter table private.organisation_affiliations enable row level security;
CREATE UNIQUE INDEX organisation_affiliations_active_idx ON private.organisation_affiliations USING btree (organisation_id, post_id) WHERE (status = 'active'::text);
CREATE INDEX organisation_affiliations_org_idx ON private.organisation_affiliations USING btree (organisation_id, confirmed_at DESC, id DESC);
CREATE INDEX organisation_affiliations_post_idx ON private.organisation_affiliations USING btree (post_id) WHERE (status = 'active'::text);
CREATE TRIGGER organisation_affiliations_sponsorship_rules AFTER UPDATE OF status ON private.organisation_affiliations FOR EACH ROW WHEN (old.status = 'active'::text AND new.status <> 'active'::text) EXECUTE FUNCTION internal.affiliation_sponsorship_rules();
revoke all on private.organisation_affiliations from public;
