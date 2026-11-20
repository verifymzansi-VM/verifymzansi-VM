-- Reviewed rollback for updates/20261120191500_privacy_export_confirm.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so, and only while the website deployed does not call
-- api.prepare_frontend_privacy_export or api.confirm_frontend_privacy_export
-- (revert the website first): the old export command, which the update left
-- unchanged, keeps working throughout.
--
-- It refuses (55000), changing nothing, when the old export command is missing
-- or not its reviewed body (a later update, such as the step that removes it,
-- has run: undo that first), when none of the update's objects exist, or when
-- a new command that exists is not the update's body (a later update changed
-- it). It runs when only some of the update's eight objects exist, so a
-- half-applied or partly removed state can be cleared.
--
-- The rollback drops the two new commands, the unique index, the export check
-- and the export_id and export_digest columns of
-- private.privacy_request_events, deletes the 'export_prepared' events (the
-- staff audit of prepared exports; the 'exported' events stay, without their
-- export id) and puts the action list back as it was.
begin;
set local lock_timeout='5s';

do $$
declare present integer;
begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.export_frontend_privacy_request(uuid,integer)'))
      is distinct from '939737e433fcf800d5e98a3dd1569e5d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('api.export_frontend_privacy_request(uuid,integer)'))
      is distinct from '251a62d1bb6d474172d02a2867b2556a' then
    raise exception 'rollback precondition: the old export command is missing or changed' using errcode='55000';
  end if;
  select (to_regprocedure('internal.prepare_frontend_privacy_export(uuid,integer)') is not null)::integer
    + (to_regprocedure('api.prepare_frontend_privacy_export(uuid,integer)') is not null)::integer
    + (to_regprocedure('internal.confirm_frontend_privacy_export(uuid,integer,uuid)') is not null)::integer
    + (to_regprocedure('api.confirm_frontend_privacy_export(uuid,integer,uuid)') is not null)::integer
    + (exists(select 1 from pg_attribute a where a.attrelid='private.privacy_request_events'::regclass
        and a.attname='export_id' and not a.attisdropped))::integer
    + (exists(select 1 from pg_attribute a where a.attrelid='private.privacy_request_events'::regclass
        and a.attname='export_digest' and not a.attisdropped))::integer
    + (to_regclass('private.privacy_events_export_idx') is not null)::integer
    + (exists(select 1 from pg_constraint c where c.conrelid='private.privacy_request_events'::regclass
        and c.conname='privacy_request_events_export_check'))::integer
  into present;
  if present=0 then
    raise exception 'rollback precondition: the privacy export confirm update is not applied' using errcode='55000';
  end if;
  if exists(select 1 from (values
      ('internal.prepare_frontend_privacy_export(uuid,integer)','a7a7c1431e6da1c18eda98b7e18245fd'),
      ('api.prepare_frontend_privacy_export(uuid,integer)','001f2fc46398c56fd2ac6d7b3bf2cf11'),
      ('internal.confirm_frontend_privacy_export(uuid,integer,uuid)','f5fc946f1870f6516592dacf42ce90e1'),
      ('api.confirm_frontend_privacy_export(uuid,integer,uuid)','438d948a6a90a8fefd9c6bf49df8c99f')) v(sig,body)
    where to_regprocedure(v.sig) is not null
      and (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) is distinct from v.body) then
    raise exception 'rollback precondition: a new export command is not the reviewed body' using errcode='55000';
  end if;
end$$;

drop function if exists api.confirm_frontend_privacy_export(uuid,integer,uuid);
drop function if exists internal.confirm_frontend_privacy_export(uuid,integer,uuid);
drop function if exists api.prepare_frontend_privacy_export(uuid,integer);
drop function if exists internal.prepare_frontend_privacy_export(uuid,integer);

delete from private.privacy_request_events where action='export_prepared';
drop index if exists private.privacy_events_export_idx;
alter table private.privacy_request_events drop constraint if exists privacy_request_events_export_check;
alter table private.privacy_request_events drop column if exists export_digest;
alter table private.privacy_request_events drop column if exists export_id;
alter table private.privacy_request_events drop constraint if exists privacy_request_events_action_check,
  add constraint privacy_request_events_action_check check (action = any (array['submitted','recorded','assigned','unassigned','extended','identity_verified','started','rejected','completed','exported','erasure_ordered']));

notify pgrst,'reload schema';
commit;
