-- Read-only preflight for updates/20261121053224_privacy_export_simple.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only. The result has one "summary" row, then one row
-- per problem. Apply the update only when the summary is the only row and
-- reads "update not applied".
--
-- The summary says whether internal.export_frontend_privacy_request has the
-- reviewed body (update not applied) or the update's (already applied), and
-- counts the access exports recorded so far.
do $$begin
  set transaction read only;
end$$;
with body as (
  select coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
    where p.oid = to_regprocedure('internal.export_frontend_privacy_request(uuid,integer)')), 'missing') as md5
)
select 'summary' as kind,
  'privacy export simple: '
    || case b.md5 when '939737e433fcf800d5e98a3dd1569e5d' then 'update not applied'
         when '87d2eed178e199afc407b4236ffed816' then 'already applied'
         else 'unexpected state' end
    || '; exports recorded: ' || (select count(*) from private.privacy_request_events e where e.action = 'exported') as detail
from body b
union all
select 'problem', 'internal.export_frontend_privacy_request(uuid,integer) is not the reviewed body (md5 ' || b.md5 || '); do not apply the update'
from body b
where b.md5 not in ('939737e433fcf800d5e98a3dd1569e5d', '87d2eed178e199afc407b4236ffed816');
