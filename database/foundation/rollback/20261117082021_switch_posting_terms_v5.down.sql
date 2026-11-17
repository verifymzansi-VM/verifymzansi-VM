-- Reviewed rollback for updates/20261117082021_switch_posting_terms_v5.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so.
--
-- It makes posting-v4 the current posting terms again. Acceptances of
-- posting-v5 stay as history; members accept posting-v4 again before their
-- next submission or edit only if they have not accepted it before. The
-- website release with posting-v5 serves either version, so it can stay
-- deployed. It refuses (55000) unless posting-v5 is current.
begin;
set local lock_timeout='5s';

do $$begin
  if (select c.version from private.posting_terms_current c where c.singleton for update) is distinct from 'posting-v5' then
    raise exception 'rollback precondition: posting-v5 is not the current posting terms' using errcode='55000';
  end if;
end$$;

update private.posting_terms_current set version='posting-v4' where singleton and version='posting-v5';

do $$begin
  if (select c.version from private.posting_terms_current c where c.singleton) is distinct from 'posting-v4' then
    raise exception 'posting-v4 was not made current again';
  end if;
end$$;
commit;
