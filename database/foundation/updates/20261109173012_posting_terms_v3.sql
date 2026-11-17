-- Posting Terms v3 (owner decisions of 9 November 2026). Apply after
-- 20261109104020_post_expiry_rules.sql: v3 describes the rules that update
-- sets, and this file refuses to run without it.
--
-- posting-v3 is posting-v1 with three paragraphs changed: slot reuse and the
-- remaining days of a new post in a slot; what happens when a plan ends (3
-- days to reactivate, deletion with media, up to 24 hours more for a payment
-- still being confirmed, a confirmed payment keeps the post for 3 days); and
-- sold, paused, events and the records deleted with a post. The document is
-- src/lib/legal/terms-documents/posting-v3.json; its canonical hash is pinned
-- below and in src/lib/legal/terms-documents/catalogue.json. posting-v2 (seeded
-- by the baseline, never current, and absent from production) is untouched.
--
-- This file inserts the posting-v3 version row and makes it current. Every
-- member then accepts posting-v3 once, explicitly, before their next
-- submission (the submission guard and the edit-consent check compare with
-- the current version). Version rows are immutable; nothing else changes.
begin;
set local lock_timeout='5s';

do $$
declare current_version text; published_hash text;
begin
  if to_regprocedure('internal.ended_post_decision(private.posts)') is null then
    raise exception 'apply 20261109104020_post_expiry_rules.sql before posting-v3' using errcode='55000';
  end if;
  select c.version into current_version from private.posting_terms_current c where c.singleton;
  if current_version is null or current_version not in('posting-v1','posting-v3') then
    raise exception 'posting-v3 precondition: current posting terms are %, expected posting-v1',
      coalesce(current_version,'missing') using errcode='55000';
  end if;
  select v.document_hash into published_hash from private.posting_terms_versions v where v.version='posting-v3';
  if published_hash is not null and published_hash<>'p2X2YRoaYDOwYDtYhTiFcznVghgyGzRmTJ6BexfhkQE' then
    raise exception 'posting-v3 is already published with a different document' using errcode='55000';
  end if;
end$$;

insert into private.posting_terms_versions(version,document_hash) values('posting-v3','p2X2YRoaYDOwYDtYhTiFcznVghgyGzRmTJ6BexfhkQE')
  on conflict(version) do nothing;
update private.posting_terms_current set version='posting-v3' where singleton and version<>'posting-v3';

do $$begin
  if (select c.version from private.posting_terms_current c where c.singleton) is distinct from 'posting-v3' then
    raise exception 'posting-v3 was not made current';
  end if;
end$$;
commit;
