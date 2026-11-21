-- Reviewed rollback for updates/20261121094003_automatic_identity_checks.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. A website release that calls the
-- automatic identity check commands needs the update: deploy a release
-- without them first, then run this.
-- The rollback drops the update's commands, helpers, trigger and tables,
-- puts back the two constraints it widened, makes accepted_identity_facts
-- .reviewed_by required again and removes the capability
-- identity_check:configure. It refuses once anything was recorded: an
-- automatic check, an identity check appeal or a change of the setting (those
-- records are kept, so fix forward instead).
begin;
set local lock_timeout='5s';

do $$begin
  if to_regclass('private.identity_checks') is null
    or to_regprocedure('api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'rollback precondition: the automatic identity checks update is not applied' using errcode='55000';
  end if;
  if exists(select 1 from private.identity_checks) or exists(select 1 from private.identity_check_mode_events)
    or exists(select 1 from private.frontend_appeals where kind='identity_check') then
    raise exception 'rollback precondition: automatic identity checks were recorded; keep them and fix forward' using errcode='55000';
  end if;
end$$;

drop trigger if exists settle_identity_check_appeal on private.accepted_identity_facts;
drop trigger if exists settle_identity_check_appeal on private.verification_return_requests;

drop function if exists api.get_identity_check_availability();
drop function if exists api.start_my_identity_check();
drop function if exists api.ask_person_identity_check(uuid,text);
drop function if exists api.attach_identity_check_session(uuid,uuid,text);
drop function if exists api.report_identity_check_unavailable(uuid,text);
drop function if exists api.begin_identity_check_evidence(uuid,uuid);
drop function if exists api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,integer);
drop function if exists api.claim_identity_check_deletions(integer);
drop function if exists api.mark_identity_check_provider_deleted(uuid);
drop function if exists api.get_identity_check_settings();
drop function if exists api.set_identity_check_mode(text,text);
drop function if exists api.get_identity_check_for_case(uuid);
drop function if exists internal.get_identity_check_availability();
drop function if exists internal.start_my_identity_check();
drop function if exists internal.ask_person_identity_check(uuid,text);
drop function if exists internal.attach_identity_check_session(uuid,uuid,text);
drop function if exists internal.report_identity_check_unavailable(uuid,text);
drop function if exists internal.begin_identity_check_evidence(uuid,uuid);
drop function if exists internal.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,integer);
drop function if exists internal.claim_identity_check_deletions(integer);
drop function if exists internal.mark_identity_check_provider_deleted(uuid);
drop function if exists internal.get_identity_check_settings();
drop function if exists internal.set_identity_check_mode(text,text);
drop function if exists internal.get_identity_check_for_case(uuid);
drop function if exists internal.settle_identity_check_appeal();
drop function if exists internal.decline_automatic_identity_submission(uuid,uuid);
drop function if exists internal.accept_automatic_identity_submission(uuid,uuid);
drop function if exists internal.identity_check_summary(private.identity_checks);
drop function if exists internal.identity_check_askable(private.identity_checks);
drop function if exists internal.identity_check_route(uuid);

-- The appeal kinds as they were.
alter table private.frontend_appeals drop constraint if exists frontend_appeals_kind_check;
alter table private.frontend_appeals add constraint frontend_appeals_kind_check
  check (kind = any (array['suspension'::text, 'ban'::text, 'warning'::text, 'content_hidden'::text]));

-- Every accepted identity fact names its staff reviewer again.
alter table private.accepted_identity_facts
  drop constraint if exists accepted_identity_facts_decider_check,
  drop constraint if exists accepted_identity_facts_automatic_check,
  drop constraint if exists accepted_identity_facts_automatic_check_fkey,
  drop constraint if exists accepted_identity_facts_automatic_check_id_key,
  drop constraint if exists accepted_identity_facts_check2,
  add constraint accepted_identity_facts_check2 check (second_reviewer is distinct from reviewed_by);
alter table private.accepted_identity_facts drop column if exists automatic_check_id;
alter table private.accepted_identity_facts alter column reviewed_by set not null;

drop table if exists private.identity_checks;
drop table if exists private.identity_check_mode_events;
drop table if exists private.identity_check_settings;

delete from private.staff_capabilities where capability='identity_check:configure';

commit;
