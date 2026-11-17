-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_business_reply_files (
  artifact_id uuid not null,
  check_id uuid not null,
  content_digest text not null,
  mime text not null,
  constraint frontend_business_reply_files_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES private.evidence_artifacts(id) ON DELETE CASCADE,
  constraint frontend_business_reply_files_check_id_content_digest_key UNIQUE (check_id, content_digest),
  constraint frontend_business_reply_files_check_id_fkey FOREIGN KEY (check_id) REFERENCES private.frontend_business_checks(id) ON DELETE CASCADE,
  constraint frontend_business_reply_files_content_digest_check CHECK (content_digest ~ '^[0-9a-f]{64}$'::text),
  constraint frontend_business_reply_files_mime_check CHECK (mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'application/pdf'::text])),
  constraint frontend_business_reply_files_pkey PRIMARY KEY (artifact_id)
);
alter table private.frontend_business_reply_files owner to postgres;
alter table private.frontend_business_reply_files enable row level security;
revoke all on private.frontend_business_reply_files from public;
