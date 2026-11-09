-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create view private.frontend_business_seen_files with (security_invoker=true) as
 SELECT frontend_business_seen_photos.artifact_id,
    frontend_business_seen_photos.check_id,
    frontend_business_seen_photos.content_digest,
    frontend_business_seen_photos.mime,
    'visit_photo'::text AS kind
   FROM private.frontend_business_seen_photos
UNION ALL
 SELECT f.artifact_id,
    f.check_id,
    f.content_digest,
    f.mime,
    'message_attachment'::text AS kind
   FROM private.frontend_business_reply_files f
     JOIN private.frontend_business_check_messages m ON m.attachment_file_id = f.artifact_id AND m.check_id = f.check_id
UNION ALL
 SELECT d.artifact_id,
    d.check_id,
    d.content_digest,
    'application/pdf'::text AS mime,
    d.source AS kind
   FROM private.frontend_cipc_documents d
  WHERE d.recorded_at IS NOT NULL;
alter view private.frontend_business_seen_files owner to postgres;
revoke all on private.frontend_business_seen_files from public;
