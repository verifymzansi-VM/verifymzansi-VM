-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.listing_price_drafts (
  owner_id uuid not null,
  category_key text not null,
  price_mode text not null,
  price_cents bigint,
  price_negotiable boolean default false not null,
  revision integer not null,
  expires_at timestamp with time zone not null,
  constraint listing_price_drafts_category_key_check CHECK (category_key = ANY (ARRAY['property'::text, 'vehicles'::text, 'auto_parts'::text, 'electronics'::text, 'home_lifestyle'::text, 'jobs_services'::text, 'farming_agriculture'::text, 'baby_kids'::text, 'clothing_accessories'::text, 'sports_hobbies'::text, 'other_items'::text])),
  constraint listing_price_drafts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint listing_price_drafts_pkey PRIMARY KEY (owner_id),
  constraint listing_price_drafts_price_mode_check CHECK (price_mode = ANY (ARRAY['amount'::text, 'free'::text, 'on_request'::text])),
  constraint listing_price_drafts_revision_check CHECK (revision > 0),
  constraint price_draft_amount_consistency CHECK (price_mode = 'amount'::text AND price_cents IS NOT NULL AND price_cents >= 1 AND price_cents <= '9999999900'::bigint OR price_mode = 'free'::text AND price_cents IS NOT NULL AND price_cents = 0 OR price_mode = 'on_request'::text AND price_cents IS NULL),
  constraint price_draft_job_not_free CHECK (category_key <> 'jobs_services'::text OR price_mode <> 'free'::text),
  constraint price_draft_negotiability CHECK (NOT price_negotiable OR (price_mode = ANY (ARRAY['amount'::text, 'on_request'::text])) AND category_key <> 'jobs_services'::text)
);
alter table private.listing_price_drafts owner to postgres;
alter table private.listing_price_drafts enable row level security;
revoke all on private.listing_price_drafts from public;
