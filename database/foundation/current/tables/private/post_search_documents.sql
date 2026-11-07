-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_search_documents (
  post_id uuid not null,
  kind text not null,
  area text not null,
  category_key text not null,
  activity_key text,
  province_id text not null,
  city_id text,
  locality_label text not null,
  title text not null,
  summary text default ''::text not null,
  price_mode text,
  price_cents bigint,
  published_at timestamp with time zone not null,
  visible_until timestamp with time zone,
  is_visible boolean not null,
  facets jsonb default '{}'::jsonb not null,
  search_text text default ''::text not null,
  document tsvector not null,
  price_negotiable boolean default false not null,
  constraint post_search_documents_area_check CHECK (area = ANY (ARRAY['market'::text, 'business'::text, 'tourism_events'::text])),
  constraint post_search_documents_category_key_activity_key_fkey FOREIGN KEY (category_key, activity_key) REFERENCES private.category_activities(category_key, key),
  constraint post_search_documents_category_key_fkey FOREIGN KEY (category_key) REFERENCES private.categories(key),
  constraint post_search_documents_category_key_kind_area_fkey FOREIGN KEY (category_key, kind, area) REFERENCES private.categories(key, kind, area),
  constraint post_search_documents_check CHECK (price_mode IS NULL AND price_cents IS NULL OR price_mode = 'amount'::text AND price_cents > 0 OR price_mode = 'free'::text AND price_cents = 0 OR price_mode = 'on_request'::text AND price_cents IS NULL),
  constraint post_search_documents_city_id_province_id_fkey FOREIGN KEY (city_id, province_id) REFERENCES private.cities(id, province_id),
  constraint post_search_documents_facets_check CHECK (jsonb_typeof(facets) = 'object'::text),
  constraint post_search_documents_kind_check CHECK (kind = ANY (ARRAY['listing'::text, 'business'::text, 'event'::text])),
  constraint post_search_documents_locality_label_check CHECK (length(locality_label) >= 1 AND length(locality_label) <= 120),
  constraint post_search_documents_pkey PRIMARY KEY (post_id),
  constraint post_search_documents_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint post_search_documents_price_cents_check CHECK (price_cents IS NULL OR price_cents >= 0 AND price_cents <= '100000000000'::bigint),
  constraint post_search_documents_price_mode_check CHECK (price_mode = ANY (ARRAY['amount'::text, 'free'::text, 'on_request'::text])),
  constraint post_search_documents_province_id_fkey FOREIGN KEY (province_id) REFERENCES private.provinces(id),
  constraint post_search_documents_summary_check CHECK (length(summary) <= 300),
  constraint post_search_documents_title_check CHECK (length(title) >= 1 AND length(title) <= 120),
  constraint post_search_negotiable_terms CHECK (NOT price_negotiable OR kind = 'listing'::text AND category_key <> 'jobs_services'::text AND COALESCE(price_mode = ANY (ARRAY['amount'::text, 'on_request'::text]), false))
);
alter table private.post_search_documents owner to postgres;
alter table private.post_search_documents enable row level security;
CREATE INDEX post_search_area_idx ON private.post_search_documents USING btree (area, published_at DESC, post_id DESC) WHERE is_visible;
CREATE INDEX post_search_category_idx ON private.post_search_documents USING btree (category_key, published_at DESC, post_id DESC) WHERE is_visible;
CREATE INDEX post_search_document_idx ON private.post_search_documents USING gin (document) WHERE is_visible;
CREATE INDEX post_search_facets_idx ON private.post_search_documents USING gin (facets jsonb_path_ops) WHERE is_visible;
CREATE INDEX post_search_locality_idx ON private.post_search_documents USING btree (province_id, city_id) WHERE is_visible;
CREATE INDEX post_search_recent_idx ON private.post_search_documents USING btree (published_at DESC, post_id DESC) WHERE is_visible;
CREATE INDEX post_search_trigram_idx ON private.post_search_documents USING gin (search_text extensions.gin_trgm_ops) WHERE is_visible;
CREATE TRIGGER post_search_document_refresh BEFORE INSERT OR UPDATE OF title, summary, category_key, activity_key, locality_label ON private.post_search_documents FOR EACH ROW EXECUTE FUNCTION internal.post_search_document_refresh();
revoke all on private.post_search_documents from public;
