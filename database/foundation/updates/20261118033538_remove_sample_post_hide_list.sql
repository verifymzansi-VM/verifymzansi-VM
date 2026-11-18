-- Contract step of 20261117144001_sample_post_hide_list.sql (pull request
-- 105): remove the sample post hide-list.
--
-- The display-only sample posts were removed from the website (the catalogue,
-- the /sample pages, the staff page and the showroom cards). No website release
-- after that removal calls the two commands below, and its runtime manifest no
-- longer lists them.
--
-- In one transaction it drops:
-- 1. api.set_sample_post_hidden(text,boolean) (staff) and
--    internal.set_sample_post_hidden(text,boolean) behind it;
-- 2. api.get_hidden_sample_posts() (public read) and
--    internal.get_hidden_sample_posts() behind it;
-- 3. the table private.hidden_sample_posts, with any rows it holds (which
--    catalogue slugs staff had removed; nothing else refers to them).
--
-- It refuses (55000) when only part of the hide-list exists. Running it again
-- once everything is gone changes nothing. No other object changes.
--
-- ORDER: merge the pull request first and let its website release deploy,
-- then apply (a contract step). The deploy preflight probes only the commands
-- in the release's runtime manifest, so production may keep these two commands
-- until this update is applied; it reports the update as pending ("database
-- behind by 1") until then.
-- Read-only preflight:
-- ../preflight/20261118033538_remove_sample_post_hide_list.check.sql.
-- Rollback: ../rollback/20261118033538_remove_sample_post_hide_list.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: all of the hide-list exists, or none of it does.
do $$
declare present integer;
begin
  select (to_regclass('private.hidden_sample_posts') is not null)::integer
    + (to_regprocedure('internal.set_sample_post_hidden(text,boolean)') is not null)::integer
    + (to_regprocedure('api.set_sample_post_hidden(text,boolean)') is not null)::integer
    + (to_regprocedure('internal.get_hidden_sample_posts()') is not null)::integer
    + (to_regprocedure('api.get_hidden_sample_posts()') is not null)::integer
  into present;
  if present not in (0, 5) then
    raise exception 'remove sample post hide list precondition: % of 5 objects exist', present
      using errcode='55000';
  end if;
end$$;

drop function if exists api.set_sample_post_hidden(text,boolean);
drop function if exists internal.set_sample_post_hidden(text,boolean);
drop function if exists api.get_hidden_sample_posts();
drop function if exists internal.get_hidden_sample_posts();
drop table if exists private.hidden_sample_posts;

notify pgrst,'reload schema';
commit;
