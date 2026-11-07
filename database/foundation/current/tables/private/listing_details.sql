-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.listing_details (
  post_id uuid not null,
  post_kind text default 'listing'::text not null,
  price_mode text,
  price_cents bigint,
  price_negotiable boolean default false not null,
  attributes jsonb default '{}'::jsonb not null,
  attributes_version integer default 1 not null,
  constraint core_detail_price_category TRIGGER DEFERRABLE INITIALLY DEFERRED,
  constraint core_listing_detail TRIGGER DEFERRABLE INITIALLY DEFERRED,
  constraint core_price_consistency CHECK (price_mode IS NULL AND price_cents IS NULL AND NOT price_negotiable OR price_mode IS NOT NULL AND (price_mode = 'amount'::text AND price_cents IS NOT NULL AND price_cents >= 1 AND price_cents <= '9999999900'::bigint OR price_mode = 'free'::text AND price_cents IS NOT NULL AND price_cents = 0 AND NOT price_negotiable OR price_mode = 'on_request'::text AND price_cents IS NULL)),
  constraint listing_details_attributes_check CHECK (jsonb_typeof(attributes) = 'object'::text AND octet_length(attributes::text) <= 16384),
  constraint listing_details_attributes_version_fkey FOREIGN KEY (attributes_version) REFERENCES private.reference_catalog_versions(version),
  constraint listing_details_pkey PRIMARY KEY (post_id),
  constraint listing_details_post_id_post_kind_fkey FOREIGN KEY (post_id, post_kind) REFERENCES private.posts(id, kind) ON DELETE CASCADE,
  constraint listing_details_post_kind_check CHECK (post_kind = 'listing'::text)
);
alter table private.listing_details owner to postgres;
alter table private.listing_details enable row level security;
CREATE CONSTRAINT TRIGGER core_detail_price_category AFTER INSERT OR UPDATE ON private.listing_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.core_listing_price_guard();
CREATE CONSTRAINT TRIGGER core_listing_detail AFTER INSERT OR DELETE OR UPDATE ON private.listing_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.core_detail_guard();
CREATE TRIGGER core_listing_no_truncate BEFORE TRUNCATE ON private.listing_details FOR EACH STATEMENT EXECUTE FUNCTION internal.core_no_detail_truncate();
CREATE TRIGGER listing_attributes_valid BEFORE INSERT OR UPDATE ON private.listing_details FOR EACH ROW EXECUTE FUNCTION internal.listing_attributes_guard();
CREATE TRIGGER post_edit_listing_frozen BEFORE INSERT OR DELETE OR UPDATE ON private.listing_details FOR EACH ROW EXECUTE FUNCTION internal.post_edit_guard();
revoke all on private.listing_details from public;
