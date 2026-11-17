-- Make posting-v5 the current posting terms (owner's decision of 16 November
-- 2026: the Terms must describe how people pay now). posting-v5 is published
-- by 20261117082020_online_payment_limit.sql; this file refuses to run
-- without it (canonical hash pinned below).
--
-- Order: apply AFTER the website release that contains
-- src/lib/legal/terms-documents/posting-v5.json is deployed. That release
-- serves posting-v4 or posting-v5, whichever the database says is current; an
-- earlier website knows no posting-v5 and would refuse the current terms (no
-- post could be submitted or edited) until it is replaced.
--
-- It changes only private.posting_terms_current: no function, table, grant,
-- plan, payment or acceptance. Every member then accepts posting-v5 once
-- before their next submission or edit; new payments record posting-v5 with
-- their cooling-off consent. Run again, it changes nothing.
-- Read-only preflight: ../preflight/20261117082021_switch_posting_terms_v5.check.sql.
-- Rollback: ../rollback/20261117082021_switch_posting_terms_v5.down.sql.
begin;
set local lock_timeout='5s';

do $$
declare current_version text; v5_hash text;
begin
  select c.version into current_version from private.posting_terms_current c where c.singleton for update;
  if current_version is null or current_version not in('posting-v4','posting-v5') then
    raise exception 'switch precondition: current posting terms are %, expected posting-v4',
      coalesce(current_version,'missing') using errcode='55000';
  end if;
  select v.document_hash into v5_hash from private.posting_terms_versions v where v.version='posting-v5';
  if v5_hash is distinct from 'LkgzMkvecZ75fguL1-eUNxwRsHZpg9pi42CTae2Q5mc' then
    raise exception 'switch precondition: apply 20261117082020_online_payment_limit.sql first (posting-v5 is %)',
      case when v5_hash is null then 'not published' else 'published with a different document' end
      using errcode='55000';
  end if;
end$$;

update private.posting_terms_current set version='posting-v5' where singleton and version<>'posting-v5';

do $$begin
  if (select c.version from private.posting_terms_current c where c.singleton) is distinct from 'posting-v5' then
    raise exception 'posting-v5 was not made current';
  end if;
end$$;
commit;
