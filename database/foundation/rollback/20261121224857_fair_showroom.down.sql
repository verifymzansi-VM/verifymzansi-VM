-- Reviewed rollback for updates/20261121224857_fair_showroom.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. The website's showroom then
-- falls back to the newest posts (its read fails closed to that list).
-- The rollback drops api.showroom_feed and internal.showroom_feed. The update
-- stores nothing, so no data goes.
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.showroom_feed(jsonb)'), ('api.showroom_feed(jsonb)')) v(sig)
  loop
    if shape not in (
        'internal.showroom_feed(jsonb) f4c4e91aa56bd9f3bb985c01d0c3d280',
        'api.showroom_feed(jsonb) 20563a7dac3f7a15e63b08d6f00460da') then
      raise exception 'rollback precondition: the fair showroom update is not applied as reviewed (%)', shape
        using errcode='55000';
    end if;
  end loop;
end$$;

drop function api.showroom_feed(jsonb);
drop function internal.showroom_feed(jsonb);

commit;
