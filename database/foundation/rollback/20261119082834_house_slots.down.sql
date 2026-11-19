-- Reviewed rollback for updates/20261119082834_house_slots.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It refuses (55000) unless the three added functions have this update's
-- bodies (a later update changed one: undo that update first), and once any
-- house slot was granted (private.house_slot_events holds a row): dropping the
-- table would lose that record, and the slots would no longer end with the
-- admin role. Otherwise it drops the trigger on private.staff_roles, the three
-- functions and the table. No other row or function is changed.
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.grant_house_slots(text,integer,integer,text,text)'),
      ('internal.end_house_slot(uuid,text)'),
      ('internal.house_slots_on_staff_role_change()')) v(sig)
  loop
    if shape not in (
        'internal.grant_house_slots(text,integer,integer,text,text) d456341442ebecc2d5a28d2b824d4433',
        'internal.end_house_slot(uuid,text) bbd9eded84273b962814a997daaed2e4',
        'internal.house_slots_on_staff_role_change() f100ded1785d690054ba54e150e33bff') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
  if pg_catalog.to_regclass('private.house_slot_events') is null then
    raise exception 'rollback precondition: private.house_slot_events is missing' using errcode='55000';
  end if;
end$$;
do $$
begin
  if exists(select 1 from private.house_slot_events) then
    raise exception 'rollback precondition: % house slot events are recorded; the earlier schema cannot keep them (fix forward)',
      (select count(*) from private.house_slot_events) using errcode='55000';
  end if;
end$$;

drop trigger if exists staff_roles_end_house_slots on private.staff_roles;
drop function if exists internal.house_slots_on_staff_role_change();
drop function if exists internal.grant_house_slots(text,integer,integer,text,text);
drop function if exists internal.end_house_slot(uuid,text);
drop table if exists private.house_slot_events;

notify pgrst,'reload schema';
commit;
