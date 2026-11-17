-- Reviewed rollback for updates/20261109173012_posting_terms_v3.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix (a new version). It makes
-- posting-v1 current again. The posting-v3 version row and any acceptances of
-- it stay: published terms are immutable and acceptances are records.
--
-- What changes on rollback: members must have accepted posting-v1 before their
-- next submission (members who accepted only posting-v3 accept posting-v1 at
-- /post/create). posting-v1 describes the earlier rules ("stay saved"), so roll
-- this back only together with 20261109104020_post_expiry_rules.sql, and
-- deploy a website release whose catalogue.json names posting-v1 as active.
begin;
set local lock_timeout='5s';

do $$begin
  if (select c.version from private.posting_terms_current c where c.singleton) is distinct from 'posting-v3' then
    raise exception 'rollback precondition: posting-v3 is not the current posting terms';
  end if;
  if not exists(select 1 from private.posting_terms_versions v where v.version='posting-v1'
      and v.document_hash='RAXTzmTyM5iMYeLy8Xv_NvnvzqsjUKPYq5hQaqqNS1Q') then
    raise exception 'rollback precondition: posting-v1 is missing';
  end if;
end$$;

update private.posting_terms_current set version='posting-v1' where singleton;
commit;
