-- Read-only preflight for updates/20261117123240_skipped_email_status.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.complete_notification_outbox and
-- internal.list_my_email_history have the reviewed earlier bodies (update not
-- applied), the update's (already applied), or a mix (partly applied), and
-- counts:
-- - "finished emails": queued emails finished (sent or skipped);
-- - "marked skipped": finished emails stored with the reason 'skipped'
--   (always 0 before the update: the earlier body clears every reason).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.complete_notification_outbox(uuid,uuid,boolean,text)',
      'a87eff16c79b115b0bb2f385b7e41fa9', 'd0ac8636fcde58e25ca51bef842ea434'),
    ('internal.list_my_email_history(integer)',
      'bae293aa4451ea71502c27863c1cf5e6', 'af3d191eb50ae6e67a6417269ef39876')
  ) v(sig, reviewed, updated)
),
state as (
  select bool_and(body is not distinct from reviewed) as absent,
    bool_and(body is not distinct from updated) as applied
  from bodies
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
  from bodies where body is distinct from reviewed and body is distinct from updated
)
select 'summary' as kind,
  'skipped email status: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; finished emails: '
    || (select count(*) from private.outbox_events o where o.processed_at is not null)
    || '; marked skipped: '
    || (select count(*) from private.outbox_events o
        where o.processed_at is not null and o.delivery_error = 'skipped') as detail
from state s
union all
select kind, detail from problems;
