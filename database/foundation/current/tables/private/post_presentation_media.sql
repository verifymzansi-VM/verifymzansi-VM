-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_presentation_media (
  post_id uuid not null,
  object_id uuid not null,
  purpose text not null,
  "position" smallint not null,
  constraint post_presentation_media_check CHECK ("position" >= 0 AND "position" <= 9 AND (purpose = 'venue'::text OR "position" = 0)),
  constraint post_presentation_media_object_id_fkey FOREIGN KEY (object_id) REFERENCES private.media_objects(id) ON DELETE RESTRICT,
  constraint post_presentation_media_pkey PRIMARY KEY (post_id, purpose, "position"),
  constraint post_presentation_media_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint post_presentation_media_post_id_purpose_object_id_key UNIQUE (post_id, purpose, object_id),
  constraint post_presentation_media_purpose_check CHECK (purpose = ANY (ARRAY['logo'::text, 'poster'::text, 'venue'::text]))
);
alter table private.post_presentation_media owner to postgres;
alter table private.post_presentation_media enable row level security;
CREATE INDEX post_presentation_media_object_idx ON private.post_presentation_media USING btree (object_id);
CREATE TRIGGER post_presentation_media_unlink_clock AFTER DELETE OR UPDATE OF object_id ON private.post_presentation_media FOR EACH ROW EXECUTE FUNCTION internal.media_unlink_clock();
revoke all on private.post_presentation_media from public;
