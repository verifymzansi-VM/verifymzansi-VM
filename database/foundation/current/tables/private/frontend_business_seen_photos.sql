-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_business_seen_photos (
  artifact_id uuid not null,
  check_id uuid not null,
  verifier_id uuid,
  content_digest text not null,
  mime text not null,
  latitude numeric(7,5),
  longitude numeric(8,5),
  created_at timestamp with time zone default clock_timestamp() not null,
  constraint frontend_business_seen_photos_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES private.evidence_artifacts(id) ON DELETE CASCADE,
  constraint frontend_business_seen_photos_check_id_content_digest_key UNIQUE (check_id, content_digest),
  constraint frontend_business_seen_photos_check_id_fkey FOREIGN KEY (check_id) REFERENCES private.frontend_business_checks(id) ON DELETE CASCADE,
  constraint frontend_business_seen_photos_content_digest_check CHECK (content_digest ~ '^[0-9a-f]{64}$'::text),
  constraint frontend_business_seen_photos_latitude_check CHECK (latitude >= '-90'::integer::numeric AND latitude <= 90::numeric),
  constraint frontend_business_seen_photos_longitude_check CHECK (longitude >= '-180'::integer::numeric AND longitude <= 180::numeric),
  constraint frontend_business_seen_photos_mime_check CHECK (mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])),
  constraint frontend_business_seen_photos_pkey PRIMARY KEY (artifact_id),
  constraint frontend_business_seen_photos_verifier_id_fkey FOREIGN KEY (verifier_id) REFERENCES auth.users(id) ON DELETE SET NULL
);
alter table private.frontend_business_seen_photos owner to postgres;
alter table private.frontend_business_seen_photos enable row level security;
CREATE INDEX frontend_business_seen_photos_verifier_idx ON private.frontend_business_seen_photos USING btree (verifier_id);
revoke all on private.frontend_business_seen_photos from public;
