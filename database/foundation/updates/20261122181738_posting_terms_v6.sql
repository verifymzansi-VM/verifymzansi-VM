-- Posting terms posting-v6: the Multi-listing package rules, paid add-ons and
-- the settled legal answers (launch checklist item 27). Publishes posting-v6
-- and makes it current, in one transaction.
--
-- posting-v6 (src/lib/legal/terms-documents/posting-v6.json, canonical hash
-- pinned below and in src/lib/legal/terms-documents/catalogue.json) is
-- posting-v5 plus: the Multi-listing package rules as built (5 to 250 slots,
-- R100 per slot per 30 days, terms of 30, 90 or 180 days, all slots ending
-- together, fair use across the package, one package per account, ID review
-- first, Individual slots while a package runs, adding slots part-way online
-- or by invoice, no renewal, posts when a package ends, no transfers); paying
-- by invoice above 100 slots at the same price; the paid add-ons and their
-- prices; the written notice before a term of 180 days or more ends; no
-- interest or late fee on an invoice; the first purchase refundable within 5
-- business days; refunds to the original method or an account in the
-- member's own name; lost days added back after an overturned suspension;
-- the content licence; the children rule; restricted goods; and removal on a
-- credible complaint.
--
-- It changes only private.posting_terms_versions (one new row) and
-- private.posting_terms_current: no function, table, grant, plan, price,
-- payment or acceptance. Packages stay off sale (private.slot_package_sales is
-- not touched). Every member then accepts posting-v6 once before their next
-- submission or edit; new payments record posting-v6 with their cooling-off
-- consent. Run again, it changes nothing.
--
-- It refuses (55000) unless posting-v5 (or posting-v6) is current, posting-v6
-- is absent or published with the hash below, and the written notice before
-- a long term ends (20261122111209_term_ending_notice.sql, which posting-v6
-- describes) is applied.
--
-- ORDER: website-first. Apply it straight AFTER the website release that
-- contains posting-v6.json is deployed. That release serves posting-v5 or
-- posting-v6, whichever the database says is current; an earlier website
-- knows no posting-v6 and would refuse the current terms (no post could be
-- submitted or edited) until it is replaced.
-- Read-only preflight: ../preflight/20261122181738_posting_terms_v6.check.sql.
-- Rollback: ../rollback/20261122181738_posting_terms_v6.down.sql.
begin;
set local lock_timeout='5s';

do $$
declare current_version text; v6_hash text;
begin
  select c.version into current_version from private.posting_terms_current c where c.singleton for update;
  if current_version is null or current_version not in('posting-v5','posting-v6') then
    raise exception 'posting-v6 precondition: current posting terms are %, expected posting-v5',
      coalesce(current_version,'missing') using errcode='55000';
  end if;
  select v.document_hash into v6_hash from private.posting_terms_versions v where v.version='posting-v6';
  if v6_hash is not null and v6_hash<>'5cAClZNQXGLoMM17BDDA3QGCJvwSRcfbC4NEcDH5EJM' then
    raise exception 'posting-v6 is already published with a different document' using errcode='55000';
  end if;
  if to_regprocedure('internal.queue_term_ending_notices(integer)') is null then
    raise exception 'posting-v6 precondition: apply 20261122111209_term_ending_notice.sql first'
      using errcode='55000';
  end if;
end$$;

insert into private.posting_terms_versions(version,document_hash) values('posting-v6','5cAClZNQXGLoMM17BDDA3QGCJvwSRcfbC4NEcDH5EJM')
  on conflict(version) do nothing;

update private.posting_terms_current set version='posting-v6' where singleton and version<>'posting-v6';

do $$begin
  if not exists(select 1 from private.posting_terms_versions v
      where v.version='posting-v6' and v.document_hash='5cAClZNQXGLoMM17BDDA3QGCJvwSRcfbC4NEcDH5EJM') then
    raise exception 'posting-v6 was not published';
  end if;
  if (select c.version from private.posting_terms_current c where c.singleton) is distinct from 'posting-v6' then
    raise exception 'posting-v6 was not made current';
  end if;
end$$;
commit;
