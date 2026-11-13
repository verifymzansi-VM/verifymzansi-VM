-- Posting Terms v4 (Pricing v2, roadmap P1): publish the document now, make it
-- current later.
--
-- posting-v4 states the slot prices of Pricing v2 (R69 per Individual slot for
-- each 30 days), the limits, payment by invoice above R10,000, the cooling-off
-- consent, the refund and cancellation policy, the free 7-day first post from
-- its approval and partner referral links. The document is
-- src/lib/legal/terms-documents/posting-v4.json; its canonical hash is pinned
-- below and in src/lib/legal/terms-documents/catalogue.json, whose active
-- version stays posting-v3.
--
-- This file only inserts the posting-v4 version row. It does NOT make posting-v4
-- current: the website still sells the plans that posting-v3 describes, so
-- members keep accepting posting-v3 and nobody can accept posting-v4 yet
-- (internal.accept_posting_terms accepts only the current version). posting-v4
-- becomes current in a later, separately reviewed update, once every behaviour
-- it promises is live, applied straight after the catalogue change that puts
-- the new slots on sale and straight before the release that shows them, so
-- the Terms members accept, the pricing page and the amount charged change at
-- the same moment (updates/README.md, Posting Terms v4).
--
-- Version rows are immutable (posting_terms_document_immutable). Nothing else
-- changes: no function, table, grant or acceptance.
begin;
set local lock_timeout='5s';

do $$
declare current_version text; published_hash text;
begin
  select c.version into current_version from private.posting_terms_current c where c.singleton;
  if current_version is null or current_version not in('posting-v3','posting-v4') then
    raise exception 'posting-v4 precondition: current posting terms are %, expected posting-v3',
      coalesce(current_version,'missing') using errcode='55000';
  end if;
  select v.document_hash into published_hash from private.posting_terms_versions v where v.version='posting-v4';
  if published_hash is not null and published_hash<>'HnObmeyoZjiuPQSF0z0aUgs_t_st87EUjVQGjDahozg' then
    raise exception 'posting-v4 is already published with a different document' using errcode='55000';
  end if;
  -- Read by the final check: this file never changes the current version.
  perform pg_catalog.set_config('vm.posting_terms_before_v4',current_version,true);
end$$;

insert into private.posting_terms_versions(version,document_hash) values('posting-v4','HnObmeyoZjiuPQSF0z0aUgs_t_st87EUjVQGjDahozg')
  on conflict(version) do nothing;

do $$begin
  if not exists(select 1 from private.posting_terms_versions v
      where v.version='posting-v4' and v.document_hash='HnObmeyoZjiuPQSF0z0aUgs_t_st87EUjVQGjDahozg') then
    raise exception 'posting-v4 was not published';
  end if;
  if (select c.version from private.posting_terms_current c where c.singleton)
      is distinct from pg_catalog.current_setting('vm.posting_terms_before_v4',true) then
    raise exception 'publishing posting-v4 must not change the current posting terms';
  end if;
end$$;
commit;
