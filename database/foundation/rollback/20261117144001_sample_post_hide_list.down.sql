-- Reviewed rollback for updates/20261117144001_sample_post_hide_list.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It drops the two commands, their internal functions and the hide-list table
-- (and with it which samples staff removed). Switch samples off first
-- (SAMPLE_POSTS_ENABLED): the website shows no sample at all while it cannot
-- read the hide-list. It refuses (55000) unless every part of the update is
-- present.
begin;
set local lock_timeout='5s';

do $$
begin
  if to_regclass('private.hidden_sample_posts') is null
    or to_regprocedure('internal.set_sample_post_hidden(text,boolean)') is null
    or to_regprocedure('api.set_sample_post_hidden(text,boolean)') is null
    or to_regprocedure('internal.get_hidden_sample_posts()') is null
    or to_regprocedure('api.get_hidden_sample_posts()') is null then
    raise exception 'rollback precondition: the sample post hide list is not fully present'
      using errcode='55000';
  end if;
end$$;

drop function api.set_sample_post_hidden(text,boolean);
drop function internal.set_sample_post_hidden(text,boolean);
drop function api.get_hidden_sample_posts();
drop function internal.get_hidden_sample_posts();
drop table private.hidden_sample_posts;

notify pgrst,'reload schema';
commit;
