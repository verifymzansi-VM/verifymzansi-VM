-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_media (
  post_id uuid not null,
  object_id uuid not null,
  purpose text not null,
  "position" smallint not null,
  focal_x numeric(4,3),
  focal_y numeric(4,3),
  constraint post_media_focal_x_check CHECK (focal_x >= 0::numeric AND focal_x <= 1::numeric),
  constraint post_media_focal_y_check CHECK (focal_y >= 0::numeric AND focal_y <= 1::numeric),
  constraint post_media_object_id_fkey FOREIGN KEY (object_id) REFERENCES private.media_objects(id) ON DELETE RESTRICT,
  constraint post_media_pkey PRIMARY KEY (post_id, purpose, "position"),
  constraint post_media_position_check CHECK ("position" >= 0 AND "position" <= 49),
  constraint post_media_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint post_media_post_id_purpose_object_id_key UNIQUE (post_id, purpose, object_id),
  constraint post_media_purpose_check CHECK (purpose = ANY (ARRAY['cover'::text, 'gallery'::text, 'logo'::text, 'video'::text]))
);
alter table private.post_media owner to postgres;
alter table private.post_media enable row level security;
CREATE INDEX post_media_object_idx ON private.post_media USING btree (object_id);
CREATE UNIQUE INDEX post_media_one_cover_idx ON private.post_media USING btree (post_id) WHERE (purpose = 'cover'::text);
CREATE UNIQUE INDEX post_media_one_logo_idx ON private.post_media USING btree (post_id) WHERE (purpose = 'logo'::text);
CREATE TRIGGER post_edit_media_frozen BEFORE INSERT OR DELETE OR UPDATE ON private.post_media FOR EACH ROW EXECUTE FUNCTION internal.post_edit_guard();
CREATE TRIGGER post_media_unlink_clock AFTER DELETE OR UPDATE OF object_id ON private.post_media FOR EACH ROW EXECUTE FUNCTION internal.media_unlink_clock();
revoke all on private.post_media from public;
