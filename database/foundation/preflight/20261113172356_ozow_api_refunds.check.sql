-- Read-only preflight for updates/20261113172356_ozow_api_refunds.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (its 33 new functions and the
-- channel column of private.payment_refund_requests are absent, and the five
-- functions it replaces have their reviewed earlier bodies) or applied (every
-- body is the update's and the column is present), and counts the refunds
-- waiting for approval and, once applied, the refunds through Ozow approved or
-- sent and not settled. A problem row is shown when
-- 20261113085340_retire_old_staff_reversal_commands.sql is not applied, or a
-- function this update needs or replaces has another body.
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.ozow_refund_transaction(uuid)', '936ee7437cc4a204e8357e840d103b0b'),
    ('internal.reverse_payment_line(uuid,text,text,uuid)', '3f95168e1faacac2ca6f1431962c182c'),
    ('internal.ozow_refund_problem(uuid,text,text,text)', '8c7462925151c5f8f040162fb6263dc6'),
    ('internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb)', '90fd7db662d18b89fdce0e395f92ea0c'),
    ('internal.request_staff_ozow_refund(uuid,uuid,text,text)', '2a6c9cb2ea7f62132bc10f29d4a27ab7'),
    ('api.request_staff_ozow_refund(uuid,uuid,text,text)', 'cf120b37f56a25599011105d66e1a94b'),
    ('internal.record_staff_dashboard_refund(uuid,uuid,text,text,uuid,jsonb)', 'df0d1a2dbf3d2f306adc7eba2957e11b'),
    ('api.record_staff_dashboard_refund(uuid,uuid,text,text,uuid,jsonb)', '835bdc316f8762ee0c441d86e79f82a8'),
    ('internal.staff_ozow_refund_view(private.payment_refund_requests,uuid)', 'c4ff0e12f1bfde14f2a0d7d1d5800a9c'),
    ('internal.get_staff_ozow_refunds(uuid[])', 'ed9a446630dda6bdda7c78248da278a6'),
    ('api.get_staff_ozow_refunds(uuid[])', '09755b758fde6141a93a2afc7ee43ece'),
    ('internal.claim_ozow_refund_send(uuid)', '0b9666cbe9d56092d32b11e326c1fb90'),
    ('api.claim_ozow_refund_send(uuid)', '436a4f6cf0ad64bc3c1eabc1bc079b2a'),
    ('internal.list_ozow_refund_sends_due(integer)', '34b44167b37d7dcea9e2b5a0e7a17744'),
    ('api.list_ozow_refund_sends_due(integer)', '410a5f50adefa396587ac5045f80e326'),
    ('internal.apply_ozow_refund_state(uuid,text,timestamptz,timestamptz,text)', '431e2541a83cf8e892efd61aa5cacd4d'),
    ('internal.valid_ozow_refund_fact(jsonb)', '023cde0ed9da4adc588737b40751899d'),
    ('internal.ozow_transaction_payment(uuid)', 'bfeb28fb4e3eea65fd4b51c3e3e2a0fa'),
    ('internal.record_ozow_refund_send(uuid,jsonb)', '9e3bafab54e36843cc570cf196e9babf'),
    ('api.record_ozow_refund_send(uuid,jsonb)', 'de2a72c4eaf64a58d7c4917b76cb0208'),
    ('internal.apply_ozow_refund_status(jsonb)', '22b002f9363cae60fd6b40635590a3a9'),
    ('api.apply_ozow_refund_status(jsonb)', 'cb0b3fd2432f28aedac7dcbdf7d1a2cb'),
    ('internal.reconcile_ozow_refunds(jsonb)', '218a119128346ee7df387e651494eef1'),
    ('api.reconcile_ozow_refunds(jsonb)', 'ea40cc8571dab987fcb5b49d9f27ba53')
    ,('internal.ozow_refund_link_candidate(uuid,uuid,bigint,timestamp with time zone)', 'f73ba1c23d33d6a03ad992fd34c71d8c'),
    ('internal.claim_ozow_refund_checks(integer)', 'fc88a84efa8b427b1c176e3e41762775'),
    ('api.claim_ozow_refund_checks(integer)', 'af55530f14c06e80b56017c55d407725'),
    ('internal.report_ozow_refund_missing(uuid)', 'b7ae6c2deac0c275b3bad89dec3c81fb'),
    ('api.report_ozow_refund_missing(uuid)', 'dc4ee76940d144ff60fcbca0cc0d1f72'),
    ('internal.close_staff_ozow_refund(uuid,text)', '5b7a8a8d3f7bd430e0024fb2088338c3'),
    ('api.close_staff_ozow_refund(uuid,text)', '916b8177461b733dbab5060a07f8e5e1'),
    ('internal.get_staff_refund_context(uuid,uuid,uuid)', '00a72d4c37e7ea2726f3f47bfa9c4d97'),
    ('api.get_staff_refund_context(uuid,uuid,uuid)', 'f7580a68a1fb083278b2bea3a69909dd')
  ) v(sig, after)
),
replaced as (
  select v.sig, v.before, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.payment_refund_request_guard()', 'ac76d0b81b37bbfc12ad483e7eadf9cf', 'c220af13b94b20251d36a33fe643e427'),
    ('internal.payment_refunded_before_cents(uuid)', 'deeeb438b3d54710a061b49a4e52e9f5', 'edcb14caf62c8375f0216d828ecc276d'),
    ('internal.approve_staff_payment_refund(uuid)', 'f757a5e1ac7aa4a199dbcd05f5465083', 'df4585dd0d0c12f4fbf2e76d9e70a553'),
    ('internal.payment_reversal_waiting_guard()', 'ee9f44cbbc9d2b70cd6db25f90dc7acb', 'd994c95ef0874bb69be72b4e54666ae7'),
    ('internal.record_payment_problem(uuid,text,text,boolean,text)', 'cd1051937fb931de8ced633770d8c9b7', '73a0ff98c9e3f2003e76349481435cba')
  ) v(sig, before, after)
),
needed as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.reverse_payment(uuid,text,text)', '66005adb9e06b17e689dbac47ce93d5a'),
    ('internal.record_staff_slot_reversal(uuid,text,text)', '1364f8c78e36281bae5f16a4ba5a466c'),
    ('internal.refund_needs_approval(text,bigint,bigint)', '7f3795506bf5dedfc96e78c6adb0b1ff'),
    ('internal.assert_staff_payment_actor(uuid,uuid)', 'fe81cc39557206e06346fcf5e9f33bfd')
  ) v(sig, reviewed)
),
channel as (
  select exists (select 1 from pg_attribute a where a.attrelid = to_regclass('private.payment_refund_requests')
    and a.attname = 'channel' and not a.attisdropped) as present
),
state as (
  select
    (select count(*) from added where body is null) + (select count(*) from replaced where body = before)
      + (select count(*) from channel where not present) as absent,
    (select count(*) from added where body = after) + (select count(*) from replaced where body = after)
      + (select count(*) from channel where present) as updated,
    (select count(*) from added) + (select count(*) from replaced) + 1 as total
),
problems as (
  select 'problem' as kind, sig || ' is not the update''s body (md5 ' || body || '); do not apply the update' as detail
    from added where body is not null and body is distinct from after
  union all
  select 'problem', sig || ' is neither the reviewed earlier body nor the update''s (md5 ' || coalesce(body, 'missing')
      || '); do not apply the update'
    from replaced where body is distinct from before and body is distinct from after
  union all
  select 'problem', sig || ' is not its reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update'
    from needed where body is distinct from reviewed
  union all
  select 'problem', 'apply 20261113085340_retire_old_staff_reversal_commands.sql first (the earlier staff reversal commands are still present)'
    where to_regprocedure('api.record_frontend_staff_payment_reversal(uuid,text,text)') is not null
      or to_regprocedure('api.get_frontend_staff_payments(integer,text)') is not null
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from added where body is not null and body is distinct from after)
      and not exists (select 1 from replaced where body is distinct from before and body is distinct from after)
)
select 'summary' as kind,
  'ozow api refunds: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied (apply before the pull request that uses it is merged)'
         else 'unexpected state' end
    || '; refunds waiting for approval: '
    || (select count(*) from private.payment_refund_requests where status = 'awaiting_approval')
    || '; refunds through Ozow not settled: '
    || case when not (select present from channel) then 'none (update not applied)'
         else (xpath('/row/n/text()', query_to_xml(
           'select count(*) as n from private.payment_refund_requests where channel = ''api'' and status in (''approved'', ''sent'')',
           false, true, '')))[1]::text
       end as detail
from state s
union all
select kind, detail from problems;
