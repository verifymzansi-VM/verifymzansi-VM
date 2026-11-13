-- Reviewed rollback for updates/20261113134500_communication_choices_and_signup_terms.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. First redeploy a website release
-- that does not call api.get_my_communication_choices,
-- api.save_my_communication_choices or api.list_my_email_history (one from
-- before the pull request that added them): the release that uses them answers
-- "temporarily unavailable" on the communication page without them.
--
-- WARNING: this deletes every recorded communication choice and every Terms
-- acceptance recorded at sign-up, which are the proof of what members agreed
-- to. Export both tables first (read only, in the SQL editor):
--   select * from private.communication_choice_events order by account_id, recorded_at;
--   select * from private.signup_terms_acceptances order by accepted_at;
-- and keep the export with the decision record.
--
-- The rollback removes the trigger record_signup_terms on auth.users, the 9
-- functions, the two tables and the outbox index the update added. Nothing
-- else changed, so nothing is restored.
begin;
set local lock_timeout='5s';

do $$begin
  if exists(select 1 from (values
        ('internal.record_signup_terms()', '24cf49d6570a6ca066cbde45173a3ed9'),
        ('internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean)', '62a40e158af34da3ab5cbcaf84753ab3')) v(sig, body)
      where (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) is distinct from v.body)
    or to_regclass('private.communication_choice_events') is null
    or to_regclass('private.signup_terms_acceptances') is null then
    raise exception 'rollback precondition: the communication choices and signup terms update is not applied' using errcode='55000';
  end if;
end$$;

drop trigger if exists record_signup_terms on auth.users;
drop function api.list_my_email_history(integer);
drop function internal.list_my_email_history(integer);
drop function api.save_my_communication_choices(text,boolean,boolean,boolean,boolean);
drop function internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean);
drop function api.get_my_communication_choices();
drop function internal.get_my_communication_choices();
drop function internal.communication_choices_dto(uuid);
drop function internal.record_signup_terms();
drop table private.communication_choice_events;
drop table private.signup_terms_acceptances;
drop function internal.guard_consent_record();
drop index if exists private.outbox_owner_history_idx;
commit;
