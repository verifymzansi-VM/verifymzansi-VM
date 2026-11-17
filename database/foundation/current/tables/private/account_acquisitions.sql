-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.account_acquisitions (
  account_id uuid not null,
  source text not null,
  partner_id uuid,
  organisation_id uuid,
  campaign text,
  landing_path text,
  referrer_host text,
  utm jsonb default '{}'::jsonb not null,
  first_touch_at timestamp with time zone,
  recorded_at timestamp with time zone default statement_timestamp() not null,
  constraint account_acquisitions_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint account_acquisitions_campaign_check CHECK (campaign IS NULL OR campaign ~ '^[a-z0-9][a-z0-9_-]{0,79}$'::text),
  constraint account_acquisitions_check CHECK ((source = 'partner'::text) = (partner_id IS NOT NULL)),
  constraint account_acquisitions_check1 CHECK (source <> 'organisation'::text OR organisation_id IS NOT NULL),
  constraint account_acquisitions_landing_path_check CHECK (landing_path IS NULL OR char_length(landing_path) <= 300 AND landing_path ~ '^/[A-Za-z0-9/_.~-]*$'::text),
  constraint account_acquisitions_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE SET NULL,
  constraint account_acquisitions_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES private.partners(id) ON DELETE RESTRICT,
  constraint account_acquisitions_pkey PRIMARY KEY (account_id),
  constraint account_acquisitions_referrer_host_check CHECK (referrer_host IS NULL OR referrer_host ~ '^[a-z0-9-]+([.][a-z0-9-]+)+$'::text AND char_length(referrer_host) <= 200),
  constraint account_acquisitions_source_check CHECK (source = ANY (ARRAY['direct'::text, 'organic'::text, 'social'::text, 'paid_campaign'::text, 'strategic_invite'::text, 'partner'::text, 'organisation'::text])),
  constraint account_acquisitions_utm_check CHECK (jsonb_typeof(utm) = 'object'::text)
);
alter table private.account_acquisitions owner to postgres;
alter table private.account_acquisitions enable row level security;
CREATE INDEX account_acquisitions_organisation_idx ON private.account_acquisitions USING btree (organisation_id) WHERE (organisation_id IS NOT NULL);
CREATE INDEX account_acquisitions_partner_idx ON private.account_acquisitions USING btree (partner_id) WHERE (partner_id IS NOT NULL);
revoke all on private.account_acquisitions from public;
