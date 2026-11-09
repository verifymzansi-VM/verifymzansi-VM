-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.media_objects (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  kind text not null,
  object_key text not null,
  declared_bytes integer not null,
  size_bytes integer,
  sha256 text,
  mime text,
  width integer,
  height integer,
  state text default 'intent'::text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  state_changed_at timestamp with time zone default statement_timestamp() not null,
  cleanup_token uuid,
  cleanup_lease_until timestamp with time zone,
  cleanup_attempt integer default 0 not null,
  unlinked_at timestamp with time zone,
  deleted_at timestamp with time zone,
  upload_digest text,
  constraint media_objects_check CHECK (kind = 'image'::text AND declared_bytes <= 5242880 OR kind = 'video'::text AND declared_bytes <= 52428800),
  constraint media_objects_check1 CHECK (state <> 'ready'::text OR sha256 IS NOT NULL AND size_bytes IS NOT NULL AND size_bytes <= declared_bytes AND mime IS NOT NULL),
  constraint media_objects_check2 CHECK ((state = 'deleted'::text) = (deleted_at IS NOT NULL)),
  constraint media_objects_cleanup_attempt_check CHECK (cleanup_attempt >= 0),
  constraint media_objects_declared_bytes_check CHECK (declared_bytes > 0),
  constraint media_objects_height_check CHECK (height >= 1 AND height <= 20000),
  constraint media_objects_kind_check CHECK (kind = ANY (ARRAY['image'::text, 'video'::text])),
  constraint media_objects_object_key_key UNIQUE (object_key),
  constraint media_objects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint media_objects_pkey PRIMARY KEY (id),
  constraint media_objects_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'::text),
  constraint media_objects_size_bytes_check CHECK (size_bytes > 0),
  constraint media_objects_state_check CHECK (state = ANY (ARRAY['intent'::text, 'ready'::text, 'rejected'::text, 'cleanup_required'::text, 'deleted'::text])),
  constraint media_objects_upload_digest_check CHECK (upload_digest ~ '^[a-f0-9]{64}$'::text),
  constraint media_objects_width_check CHECK (width >= 1 AND width <= 20000)
);
alter table private.media_objects owner to postgres;
alter table private.media_objects enable row level security;
CREATE INDEX media_objects_owner_idx ON private.media_objects USING btree (owner_id) WHERE (state = ANY (ARRAY['intent'::text, 'ready'::text]));
CREATE UNIQUE INDEX media_objects_upload_digest_idx ON private.media_objects USING btree (owner_id, upload_digest) WHERE ((upload_digest IS NOT NULL) AND (state = ANY (ARRAY['intent'::text, 'ready'::text])));
CREATE TRIGGER media_object_transition BEFORE UPDATE ON private.media_objects FOR EACH ROW EXECUTE FUNCTION internal.media_object_transition_guard();
revoke all on private.media_objects from public;
