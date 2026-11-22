-- Reviewed rollback for updates/20261121224857_fair_showroom.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. The website's showroom then
-- falls back to the newest posts (its read fails closed to that list).
-- The rollback drops api.showroom_feed, internal.showroom_feed and the index
-- private.moderation_log_post_approvals_idx. The update stores nothing, so no
-- data goes.
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.showroom_feed(jsonb)'), ('api.showroom_feed(jsonb)')) v(sig)
    union all
    select 'private.moderation_log_post_approvals_idx '
      ||coalesce(md5(pg_get_indexdef(to_regclass('private.moderation_log_post_approvals_idx'))),'absent')
  loop
    if shape not in (
        'internal.showroom_feed(jsonb) cf403604b9ccbc8d68267acdb41970c7',
        'api.showroom_feed(jsonb) 20563a7dac3f7a15e63b08d6f00460da',
        'private.moderation_log_post_approvals_idx 355001da88e9af5134655e1717eaea25') then
      raise exception 'rollback precondition: the fair showroom update is not applied as reviewed (%)', shape
        using errcode='55000';
    end if;
  end loop;
end$$;

drop function api.showroom_feed(jsonb);
drop function internal.showroom_feed(jsonb);
drop index private.moderation_log_post_approvals_idx;

commit;
