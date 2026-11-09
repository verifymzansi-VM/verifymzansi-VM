-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.business_details (
  post_id uuid not null,
  post_kind text default 'business'::text not null,
  business_type text,
  constraint business_details_business_type_check CHECK (business_type = ANY (ARRAY['mall_store'::text, 'standalone_shop'::text, 'home_business'::text, 'mobile_service'::text, 'online_only'::text, 'market_stall'::text])),
  constraint business_details_pkey PRIMARY KEY (post_id),
  constraint business_details_post_id_post_kind_fkey FOREIGN KEY (post_id, post_kind) REFERENCES private.posts(id, kind) ON DELETE CASCADE,
  constraint business_details_post_kind_check CHECK (post_kind = 'business'::text),
  constraint core_business_detail TRIGGER DEFERRABLE INITIALLY DEFERRED
);
alter table private.business_details owner to postgres;
alter table private.business_details enable row level security;
CREATE INDEX business_details_type_idx ON private.business_details USING btree (business_type, post_id) WHERE (business_type IS NOT NULL);
CREATE CONSTRAINT TRIGGER core_business_detail AFTER INSERT OR DELETE OR UPDATE ON private.business_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.core_detail_guard();
CREATE TRIGGER core_business_no_truncate BEFORE TRUNCATE ON private.business_details FOR EACH STATEMENT EXECUTE FUNCTION internal.core_no_detail_truncate();
CREATE TRIGGER post_edit_business_frozen BEFORE INSERT OR DELETE OR UPDATE ON private.business_details FOR EACH ROW EXECUTE FUNCTION internal.post_edit_guard();
revoke all on private.business_details from public;
