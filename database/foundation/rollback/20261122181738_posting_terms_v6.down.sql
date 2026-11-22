-- Reviewed rollback for updates/20261122181738_posting_terms_v6.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so.
--
-- It makes posting-v5 the current posting terms again. The posting-v6 row
-- stays (published terms are immutable) and acceptances of posting-v6 stay as
-- history; members accept posting-v5 again before their next submission or
-- edit only if they have not accepted it before. The website release with
-- posting-v6 serves either version, so it can stay deployed. It refuses
-- (55000) unless posting-v6 is current.
begin;
set local lock_timeout='5s';

do $$begin
  if (select c.version from private.posting_terms_current c where c.singleton for update) is distinct from 'posting-v6' then
    raise exception 'rollback precondition: posting-v6 is not the current posting terms' using errcode='55000';
  end if;
end$$;

update private.posting_terms_current set version='posting-v5' where singleton and version='posting-v6';

do $$begin
  if (select c.version from private.posting_terms_current c where c.singleton) is distinct from 'posting-v5' then
    raise exception 'posting-v5 was not made current again';
  end if;
end$$;
commit;
