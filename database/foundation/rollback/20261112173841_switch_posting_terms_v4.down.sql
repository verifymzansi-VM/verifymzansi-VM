-- Reviewed rollback for updates/20261112173841_switch_posting_terms_v4.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so, and together with a website release that names
-- posting-v3 active and sells the old plans again.
--
-- It makes posting-v3 current again and puts back on sale exactly the plan
-- versions the switch took off sale (those recorded in private.plan_sale_pauses
-- with the same retirement time), then drops that record table. Catalogue rows
-- are otherwise immutable (internal.catalogue_version_guard), so the guard
-- trigger is switched off for that one statement inside this transaction.
-- Acceptances of posting-v4 stay as records; members accept posting-v3 again.
--
-- It refuses (55000) when posting-v4 is not current, or when a plan published
-- after the switch is on sale (undo that later update first). Run before the
-- update, or a second time, it changes nothing.
begin;
set local lock_timeout='5s';

do $$
declare current_version text;
begin
  if to_regclass('private.plan_sale_pauses') is null then
    return; -- the switch is not applied (or already rolled back)
  end if;
  select c.version into current_version from private.posting_terms_current c where c.singleton for update;
  if current_version is distinct from 'posting-v4' then
    raise exception 'rollback precondition: current posting terms are %, expected posting-v4',
      coalesce(current_version,'missing') using errcode='55000';
  end if;
  if not exists(select 1 from private.posting_terms_versions v where v.version='posting-v3'
      and v.document_hash='p2X2YRoaYDOwYDtYhTiFcznVghgyGzRmTJ6BexfhkQE') then
    raise exception 'rollback precondition: posting-v3 is missing' using errcode='55000';
  end if;
  lock table private.plan_versions in share row exclusive mode;
  if exists(select 1 from private.plan_versions v where v.is_public and v.retired_at is null) then
    raise exception 'rollback precondition: plans published after the switch are on sale; undo that update first'
      using errcode='55000';
  end if;
  if exists(select 1 from private.plan_sale_pauses s join private.plan_versions v on v.id=s.plan_version_id
      where v.retired_at is distinct from s.retired_at) then
    raise exception 'rollback precondition: a paused plan was changed after the switch' using errcode='55000';
  end if;

  alter table private.plan_versions disable trigger plan_versions_immutable;
  update private.plan_versions v set retired_at=null
    from private.plan_sale_pauses s
    where s.plan_version_id=v.id and v.retired_at=s.retired_at and s.reason='posting_terms_v4_switch';
  alter table private.plan_versions enable trigger plan_versions_immutable;

  update private.posting_terms_current set version='posting-v3' where singleton;
  drop table private.plan_sale_pauses;
end$$;

do $$begin
  if to_regclass('private.plan_sale_pauses') is not null then
    raise exception 'the switch record was not removed';
  end if;
end$$;
commit;
