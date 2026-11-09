-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.posts (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  kind text not null,
  area text not null,
  category_key text not null,
  status text default 'draft'::text not null,
  revision integer default 1 not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  content_updated_at timestamp with time zone default statement_timestamp() not null,
  activity_key text,
  title text,
  description text,
  province_id text,
  city_id text,
  locality_label text,
  submitted_at timestamp with time zone,
  published_at timestamp with time zone,
  visible_until timestamp with time zone,
  status_reason text,
  edit_of uuid,
  status_changed_at timestamp with time zone default statement_timestamp() not null,
  ended_at timestamp with time zone,
  deletes_at timestamp with time zone,
  constraint core_post_detail TRIGGER DEFERRABLE INITIALLY DEFERRED,
  constraint core_post_price_category TRIGGER DEFERRABLE INITIALLY DEFERRED,
  constraint listing_attributes_category TRIGGER DEFERRABLE INITIALLY DEFERRED,
  constraint posts_activity_fkey FOREIGN KEY (category_key, activity_key) REFERENCES private.category_activities(category_key, key),
  constraint posts_area_check CHECK (area = ANY (ARRAY['market'::text, 'business'::text, 'tourism_events'::text])),
  constraint posts_category_key_kind_area_fkey FOREIGN KEY (category_key, kind, area) REFERENCES private.post_category_contracts(category_key, kind, area),
  constraint posts_check CHECK (kind = 'listing'::text AND area = 'market'::text OR kind = 'business'::text AND (area = ANY (ARRAY['business'::text, 'tourism_events'::text])) OR kind = 'event'::text AND area = 'tourism_events'::text),
  constraint posts_check1 CHECK (status <> 'sold'::text OR kind = 'listing'::text),
  constraint posts_city_province_fkey FOREIGN KEY (city_id, province_id) REFERENCES private.cities(id, province_id),
  constraint posts_description_check CHECK (description IS NULL OR length(description) <= 5000),
  constraint posts_edit_copy_state CHECK (edit_of IS NULL OR edit_of <> id AND (status = ANY (ARRAY['draft'::text, 'pending_moderation'::text, 'rejected'::text]))),
  constraint posts_edit_of_fkey FOREIGN KEY (edit_of) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint posts_ended_deletion_clock CHECK ((status <> ALL (ARRAY['expired'::text, 'sold'::text, 'archived'::text])) OR ended_at IS NOT NULL AND deletes_at IS NOT NULL),
  constraint posts_id_kind_key UNIQUE (id, kind),
  constraint posts_kind_check CHECK (kind = ANY (ARRAY['listing'::text, 'business'::text, 'event'::text])),
  constraint posts_live_has_window CHECK (status <> 'live'::text OR published_at IS NOT NULL AND visible_until IS NOT NULL AND visible_until > published_at),
  constraint posts_locality_label_check CHECK (locality_label IS NULL OR length(locality_label) >= 1 AND length(locality_label) <= 120),
  constraint posts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint posts_pkey PRIMARY KEY (id),
  constraint posts_province_id_fkey FOREIGN KEY (province_id) REFERENCES private.provinces(id),
  constraint posts_revision_check CHECK (revision > 0),
  constraint posts_status_check CHECK (status = ANY (ARRAY['draft'::text, 'pending_moderation'::text, 'live'::text, 'paused'::text, 'rejected'::text, 'expired'::text, 'sold'::text, 'archived'::text])),
  constraint posts_status_reason_check CHECK (status_reason IS NULL OR length(status_reason) <= 500),
  constraint posts_title_check CHECK (title IS NULL OR length(title) >= 1 AND length(title) <= 120)
);
alter table private.posts owner to postgres;
alter table private.posts enable row level security;
CREATE INDEX posts_active_event_owner_idx ON private.posts USING btree (owner_id) WHERE ((kind = 'event'::text) AND (status = ANY (ARRAY['pending_moderation'::text, 'live'::text])));
CREATE INDEX posts_deletion_due_idx ON private.posts USING btree (deletes_at) WHERE (deletes_at IS NOT NULL);
CREATE INDEX posts_lifecycle_idx ON private.posts USING btree (status, status_changed_at);
CREATE UNIQUE INDEX posts_one_open_edit_idx ON private.posts USING btree (edit_of) WHERE (edit_of IS NOT NULL);
CREATE INDEX posts_owner_draft_idx ON private.posts USING btree (owner_id, status);
CREATE INDEX posts_owner_submitted_idx ON private.posts USING btree (owner_id, kind, submitted_at);
CREATE TRIGGER core_identity_immutable BEFORE UPDATE ON private.posts FOR EACH ROW EXECUTE FUNCTION internal.core_identity_guard();
CREATE CONSTRAINT TRIGGER core_post_detail AFTER INSERT OR DELETE OR UPDATE ON private.posts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.core_detail_guard();
CREATE CONSTRAINT TRIGGER core_post_price_category AFTER INSERT OR UPDATE ON private.posts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.core_listing_price_guard();
CREATE TRIGGER frontend_edit_copy_created AFTER INSERT ON private.posts FOR EACH ROW EXECUTE FUNCTION internal.frontend_edit_copy_created();
CREATE TRIGGER guard_frontend_content_hold BEFORE INSERT OR UPDATE ON private.posts FOR EACH ROW EXECUTE FUNCTION internal.guard_frontend_content_hold();
CREATE TRIGGER guard_frontend_content_hold_delete BEFORE DELETE ON private.posts FOR EACH ROW EXECUTE FUNCTION internal.guard_frontend_content_hold_delete();
CREATE CONSTRAINT TRIGGER listing_attributes_category AFTER INSERT OR UPDATE ON private.posts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.listing_attributes_category_guard();
CREATE TRIGGER post_activity_guard BEFORE INSERT OR UPDATE OF category_key, activity_key ON private.posts FOR EACH ROW EXECUTE FUNCTION internal.post_activity_guard();
CREATE TRIGGER post_edit_link BEFORE INSERT OR UPDATE ON private.posts FOR EACH ROW EXECUTE FUNCTION internal.post_edit_guard();
CREATE TRIGGER post_lifecycle_clock BEFORE INSERT OR UPDATE OF status ON private.posts FOR EACH ROW EXECUTE FUNCTION internal.post_lifecycle_clock();
CREATE TRIGGER post_status_clock BEFORE UPDATE OF status ON private.posts FOR EACH ROW EXECUTE FUNCTION internal.post_status_clock();
CREATE TRIGGER posting_terms_submission_guard BEFORE INSERT OR UPDATE OF status ON private.posts FOR EACH ROW EXECUTE FUNCTION internal.guard_posting_terms_submission();
CREATE TRIGGER posts_release_activation BEFORE DELETE ON private.posts FOR EACH ROW EXECUTE FUNCTION internal.release_activation_on_post_delete();
revoke all on private.posts from public;
