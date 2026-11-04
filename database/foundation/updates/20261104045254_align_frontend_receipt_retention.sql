-- Transport receipts follow canonical evidence retention. They must not block
-- the native history purge or survive the deletion of their parent records.
begin;
set local lock_timeout='5s';
alter table private.frontend_verification_uploads
  drop constraint frontend_verification_uploads_artifact_id_fkey,
  add constraint frontend_verification_uploads_artifact_id_fkey foreign key(artifact_id) references private.evidence_artifacts(id) on delete cascade,
  drop constraint frontend_verification_uploads_case_id_owner_id_fkey,
  add constraint frontend_verification_uploads_case_id_owner_id_fkey foreign key(case_id,owner_id) references private.evidence_cases(id,subject_id) on delete cascade,
  drop constraint frontend_verification_uploads_owner_id_id_request_fkey,
  add constraint frontend_verification_uploads_owner_id_id_request_fkey foreign key(owner_id,id_request) references private.frontend_verification_uploads(owner_id,request_id) on delete cascade,
  drop constraint frontend_verification_uploads_submission_id_fkey,
  add constraint frontend_verification_uploads_submission_id_fkey foreign key(submission_id) references private.verification_identity_submissions(id) on delete cascade;
create index frontend_verification_upload_parent_idx on private.frontend_verification_uploads(owner_id,id_request) where id_request is not null;
create trigger post_presentation_media_unlink_clock after delete or update of object_id on private.post_presentation_media
  for each row execute function internal.media_unlink_clock();
commit;
