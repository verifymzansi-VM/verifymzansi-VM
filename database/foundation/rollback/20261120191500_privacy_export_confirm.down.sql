-- Reviewed rollback for updates/20261120191500_privacy_export_confirm.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so, and only while the website deployed does not call
-- api.prepare_frontend_privacy_export or api.confirm_frontend_privacy_export
-- (revert the website first): the old export command, which the update left
-- unchanged, keeps working throughout.
-- The rollback drops the two new commands, the unique index, the export id
-- check and the export_id column of private.privacy_request_events, deletes
-- the 'export_prepared' events (the staff audit of prepared exports; the
-- 'exported' events stay, without their export id) and puts the action list
-- back as it was.
begin;
set local lock_timeout='5s';

do $$begin
  if to_regprocedure('internal.confirm_frontend_privacy_export(uuid,integer,uuid)') is null
    or not exists(select 1 from pg_attribute a where a.attrelid='private.privacy_request_events'::regclass
      and a.attname='export_id' and not a.attisdropped) then
    raise exception 'rollback precondition: the privacy export confirm update is not applied' using errcode='55000';
  end if;
end$$;

drop function if exists api.confirm_frontend_privacy_export(uuid,integer,uuid);
drop function if exists internal.confirm_frontend_privacy_export(uuid,integer,uuid);
drop function if exists api.prepare_frontend_privacy_export(uuid,integer);
drop function if exists internal.prepare_frontend_privacy_export(uuid,integer);

delete from private.privacy_request_events where action='export_prepared';
drop index if exists private.privacy_events_export_idx;
alter table private.privacy_request_events drop constraint if exists privacy_request_events_export_check;
alter table private.privacy_request_events drop column if exists export_id;
alter table private.privacy_request_events drop constraint privacy_request_events_action_check,
  add constraint privacy_request_events_action_check check (action = any (array['submitted','recorded','assigned','unassigned','extended','identity_verified','started','rejected','completed','exported','erasure_ordered']));

notify pgrst,'reload schema';
commit;
