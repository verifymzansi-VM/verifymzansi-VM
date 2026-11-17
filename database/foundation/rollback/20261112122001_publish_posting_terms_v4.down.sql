-- Reviewed rollback for updates/20261112122001_publish_posting_terms_v4.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so.
--
-- The update only published the posting-v4 version row; it changed no
-- function, table, grant or acceptance, and it did not make posting-v4
-- current. Published terms are immutable, so the row stays, exactly like the
-- never-current posting-v2: while it is not current nobody can accept it and
-- nothing reads it. This file checks that this is still the case and changes
-- nothing. To withdraw the wording, revert the website release that lists
-- posting-v4 (its archive page then answers 404) and publish a corrected
-- version under a new name. Never delete or rewrite a published version.
--
-- If a later update has made posting-v4 current, this file refuses: undo that
-- later update with its own rollback first.
begin;
set local lock_timeout='5s';

do $$begin
  if (select c.version from private.posting_terms_current c where c.singleton) = 'posting-v4' then
    raise exception 'rollback precondition: posting-v4 is the current posting terms; roll back the update that made it current first'
      using errcode='55000';
  end if;
  if exists(select 1 from private.posting_terms_acceptances a where a.version='posting-v4') then
    raise exception 'rollback precondition: accounts have accepted posting-v4' using errcode='55000';
  end if;
end$$;
commit;
