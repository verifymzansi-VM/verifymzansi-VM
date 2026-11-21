-- Read-only preflight for updates/20261121143000_one_person_admin_mode.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the eight functions the update replaces have their
-- reviewed bodies, internal.single_administrator and
-- internal.assert_post_reviewer are absent, the staff audit
-- view is the reviewed one and the two new columns are absent (update not
-- applied), or everything is the update's (already applied), and counts:
-- - "ID-verified staff": accounts with an active staff role and an accepted ID
--   review (single-administrator mode applies while this is 1);
-- - "house slots": current house slots (any account);
-- - "own posts without a reviewer": pending posts (and edits, and events) of
--   an ID-verified admin that are not on a current house slot of theirs: in
--   single-administrator mode nobody can review them;
-- - "post claims by staff without an ID review": live post review claims
--   held by staff who have no current ID review (they can neither decide nor
--   renew them after the update; they expire within 15 minutes);
-- - after the update, "self-granted slot events" and "self-approved
--   decisions": rows marked so in private.house_slot_events and
--   private.moderation_log.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.grant_house_slots(text,integer,integer,text,text)',
      '77527fd29f2348e228441612a842cce2', '6d72e0bc6a5f2bee76a43563f19278ac'),
    ('internal.queue_conflict(uuid,uuid,uuid)',
      '7ef9b54c11a14dfe2f71b4e7ec474b44', 'd4c268547c2cd0fe91f8b8726a95b061'),
    ('internal.claim_queue_items(text,integer)',
      'fc822bf9b962527b0fba39c22d364735', 'f9de196ff57fbb40b2e39d587e8d5db8'),
    ('internal.moderate_post(uuid,integer,text,text,text,uuid)',
      '1f127647b461014ddc3d6d6ef6d086c7', '51a65d3cab4ec53b7c86f15e03a4937b'),
    ('internal.assert_posting_verification_ready(uuid,boolean)',
      'c54fe760620720d67cf17c644623bd6f', '45e28fa96d190f50aa15b1a106685680'),
    ('internal.claim_queue_item(text,uuid)',
      'ea7b6354f26d6a274ccdf1a4f54b3991', 'a28b6456a7ff554a868357bb504bd0d9'),
    ('internal.staff_review_post(uuid,text,uuid)',
      'b75020319ce35bcfd23ad9f9397bb043', 'bddb3dfc05f96e4c4657058517c00b8a'),
    ('internal.renew_queue_claim(text,uuid,text,uuid)',
      '18da441302347a2e62440f03b5c698ad', 'ac7babfffdc98546fb59a743a7d683fd'),
    ('internal.single_administrator(uuid)',
      null, '86df529201fa210e43106b1ad93a16ff'),
    ('internal.assert_post_reviewer(uuid,uuid)',
      null, '1725259d54dbdce5ad1c8823514444d0')
  ) v(sig, reviewed, updated)
),
shape as (
  select (select count(*) from pg_attribute a
      where (a.attrelid, a.attname) in (('private.moderation_log'::regclass, 'self_approved'),
        ('private.house_slot_events'::regclass, 'self_granted')) and not a.attisdropped) as columns,
    md5(pg_get_viewdef('private.frontend_staff_nonpayment_audit_events'::regclass)) is not distinct from '5848686f27e6a4c7987378e9ba379247' as view_reviewed,
    md5(pg_get_viewdef('private.frontend_staff_nonpayment_audit_events'::regclass)) is not distinct from 'b251677f8db6064fb8f08e1c040b4794' as view_updated
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is neither the reviewed body nor the update''s (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'private.frontend_staff_nonpayment_audit_events is not the reviewed view (md5 ' || coalesce(md5(pg_get_viewdef('private.frontend_staff_nonpayment_audit_events'::regclass)), 'missing') || '); do not apply the update'
    from shape where not view_reviewed and not view_updated
  union all
  select 'problem', 'only part of the update is present'
    from state, shape
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and (view_reviewed or view_updated)
      and not ((reviewed = total and columns = 0 and view_reviewed)
        or (updated = total and columns = 2 and view_updated))
)
select 'summary' as kind,
  'one-person admin mode: '
    || case when s.updated = s.total and sh.columns = 2 and sh.view_updated then 'already applied'
         when s.reviewed = s.total and sh.columns = 0 and sh.view_reviewed then 'update not applied'
         else 'unexpected state' end
    || '; ID-verified staff: ' || (select count(distinct r.user_id) from private.staff_roles r
         where r.revoked_at is null and internal.current_verified_identity(r.user_id) is not null)
    || '; house slots: ' || (select count(*) from private.entitlements e
         where e.source = 'staff_grant' and e.status = 'active' and e.ends_at > statement_timestamp()
           and exists (select 1 from private.house_slot_events h where h.entitlement_id = e.id))
    || '; own posts without a reviewer: ' || (select count(*) from private.posts p
         where p.status = 'pending_moderation'
           and exists (select 1 from private.staff_roles r where r.user_id = p.owner_id and r.role = 'admin'
             and r.revoked_at is null)
           and internal.current_verified_identity(p.owner_id) is not null
           and not exists (select 1 from private.post_activations a join private.entitlements e on e.id = a.entitlement_id
             where a.post_id = coalesce(p.edit_of, p.id) and a.released_at is null and e.owner_id = p.owner_id
               and e.source = 'staff_grant' and e.status = 'active' and e.ends_at > statement_timestamp()
               and exists (select 1 from private.house_slot_events h where h.entitlement_id = e.id)))
    || '; post claims by staff without an ID review: ' || (select count(*) from private.queue_claims q
         where q.post_id is not null and q.claimed_by is not null and q.claim_expires_at > clock_timestamp()
           and internal.current_verified_identity(q.claimed_by) is null)
    -- The columns exist only after the update, so they are read through
    -- query_to_xml, which runs only on this branch.
    || case when sh.columns = 2 and s.updated = s.total
         then '; self-granted slot events: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.house_slot_events where self_granted', false, true, '')))[1]::text
           || '; self-approved decisions: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.moderation_log where self_approved', false, true, '')))[1]::text
         else '' end as detail
from state s, shape sh
union all
select kind, detail from problems;
