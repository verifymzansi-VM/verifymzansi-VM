-- Read-only preflight for updates/20261110045944_intro_trial_at_first_approval.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary says whether the seven functions the update replaces are the
-- reviewed live bodies (the update replaces them) or already the updated ones,
-- and counts what step 7 of the update does now:
-- - "trials to restart": active introductory trials that never paid for a
--   published post (no post they fund is live, paused or sold, none expired in
--   them, staff approved none while they held its slot, and none of their
--   posts was deleted). The update withdraws them and frees their identity, so
--   each member gets the full free week from their first approved post.
--   "awaiting review" counts the posts in their slot that will wait for the
--   free week instead.
-- - "trials kept": the other active introductory trials; unchanged.
-- - "members with an unfunded post awaiting review": members with a new
--   Market or Business post in review that no current slot pays for. Before
--   the update such a post cannot be approved; the update lets the oldest one
--   per member wait for the member's unused free week. After the update the
--   count includes posts already waiting for it.
-- - "emails not yet sent": trial_started emails of trials to restart; the
--   update drops them (the member gets one when the free week starts).
-- After the update "trials to restart" should be 0; if a member was verified
-- while it ran, run the update again.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.reconcile_intro_trials(integer)', 'f70eb13f358548e6866e6e6444e362a2', '41dcbbcf881420460765abac8cc67462'),
    ('internal.submit_post(uuid,integer)', 'a34ca439aace1d529562d5c48bbcc125', '56b073acfb683f53c9ae5639a3f0fa0e'),
    ('internal.moderate_post(uuid,integer,text,text,text,uuid)', 'b077eccbad927c17c6e6949fb398a974', '1f127647b461014ddc3d6d6ef6d086c7'),
    ('internal.consume_frontend_post_command(uuid)', '48f301b07ef97551cc810c17c4512283', 'd765f1d3ae821aadea6f73e5f524b784'),
    ('internal.get_my_frontend_posting_allowance(text)', '19d54312c05833a2403231868a41f3eb', 'b7d28c21cea2627ff8a1a5edec8fd69c'),
    ('internal.get_my_frontend_posting_allowance_v2(text)', 'e7d1b414d321c7aa2c84e49b25c59af1', '5f289349861a6c403d88221437d6ff51'),
    ('internal.claim_supported_notification_outbox(text[],integer)', '039b1e461ee382e1e2ae7afc31f9d304', 'd1c34cc391c73fb4caa96e64025f5e27')
  ) v(sig, reviewed, updated)
),
state as (
  select count(*) filter (where body = reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
trials as (
  select e.id,
    exists(select 1 from private.post_activations a left join private.posts p on p.id = a.post_id
      where a.entitlement_id = e.id and (a.post_id is null
        or (a.released_at is null and p.status in ('live', 'paused', 'sold'))
        or a.release_reason = 'expired'
        or exists(select 1 from private.moderation_log m where m.post_id = a.post_id and m.edit_id is null
          and m.decision = 'approve' and m.decided_at >= a.activated_at
          and m.decided_at <= coalesce(a.released_at, statement_timestamp())))) as used
  from private.entitlements e
  where e.source = 'intro_trial' and e.status = 'active'
),
unfunded as (
  select distinct p.owner_id from private.posts p
  where p.status = 'pending_moderation' and p.kind <> 'event' and p.edit_of is null
    and not exists(select 1 from private.post_activations a join private.entitlements e on e.id = a.entitlement_id
      where a.post_id = p.id and a.released_at is null and e.status = 'active'
        and e.starts_at <= statement_timestamp() and e.ends_at > statement_timestamp())
),
problems as (
  select 'problem' as kind, sig || ' is missing' as detail from bodies where body is null
  union all
  select 'problem', sig || ' is not the reviewed body (md5 ' || body || '); do not apply the update'
    from bodies where body not in (reviewed, updated)
  union all
  select 'problem', 'internal.grant_intro_trial(uuid,text,integer) is not the reviewed body; do not apply the update'
    where (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure('internal.grant_intro_trial(uuid,text,integer)')) is distinct from 'c058a21c8b37300b4128d2a8b8c73d44'
  union all
  select 'problem', 'apply 20261109104020_post_expiry_rules.sql first'
    where to_regclass('private.post_deletion_extensions') is null
  union all
  select 'problem', 'private.intro_trial_requests already exists although the update is not applied'
    from state where to_regclass('private.intro_trial_requests') is not null and updated < total
  union all
  select 'problem', 'some bodies are updated and others are not' from state where updated > 0 and updated < total
)
select 'summary' as kind,
  'free week: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'reviewed live bodies, update not applied' else 'unexpected bodies' end
    || '; trials to restart: ' || (select count(*) from trials t where not t.used)
    || ' (posts awaiting review among them: '
    || (select count(*) from trials t
         join private.post_activations a on a.entitlement_id = t.id and a.released_at is null
         join private.posts p on p.id = a.post_id
         where not t.used and p.status = 'pending_moderation' and p.kind <> 'event' and p.edit_of is null)
    || '); trials kept: ' || (select count(*) from trials t where t.used)
    || '; members with an unfunded post awaiting review: ' || (select count(*) from unfunded)
    || '; emails not yet sent: '
    || (select count(*) from trials t
         join private.outbox_events o on o.kind = 'trial_started' and o.subject_id = t.id and o.processed_at is null
         where not t.used) as detail
from state s
union all
select kind, detail from problems;
