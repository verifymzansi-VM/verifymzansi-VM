-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_content_hold_media (
  hold_id uuid not null,
  object_id uuid not null,
  constraint frontend_content_hold_media_hold_id_fkey FOREIGN KEY (hold_id) REFERENCES private.frontend_content_holds(id) ON DELETE CASCADE,
  constraint frontend_content_hold_media_object_id_fkey FOREIGN KEY (object_id) REFERENCES private.media_objects(id) ON DELETE RESTRICT,
  constraint frontend_content_hold_media_pkey PRIMARY KEY (hold_id, object_id)
);
alter table private.frontend_content_hold_media owner to postgres;
alter table private.frontend_content_hold_media enable row level security;
CREATE INDEX frontend_content_hold_media_object_idx ON private.frontend_content_hold_media USING btree (object_id);
revoke all on private.frontend_content_hold_media from public;
