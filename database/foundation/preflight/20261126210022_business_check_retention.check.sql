-- Read-only preflight for updates/20261126210022_business_check_retention.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.retention_verification has its reviewed
-- body and frontend_business_checks_check1 the earlier rule (update not
-- applied) or the update's (already applied), and counts the business checks
-- the next retention sweep would act on:
-- - "details due": decided (or revoked) more than 30 days ago and still
--   holding a visit address, visit report, photo location, message, CIPC
--   document record, representative's email or call notes;
-- - "records due": ended (sticker expired or revoked, or decided) more than 12
--   months ago (a CIPC link sticker ends when its root business's sticker
--   ends) and no older approved or revoked result of the same kind is left
--   on the business (results go oldest first);
-- - "held": checks that would be due but an open legal hold on the owner or
--   fraud hold on the case keeps.
do $$begin
  set transaction read only;
end$$;
with shapes as (
  select 'internal.retention_verification(integer)' as item,
    '56e4f71f0ad4ecb994e79ea9b0d695b8' as reviewed, '87ae0ad18adf7104720d88bb0dc3d922' as updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure('internal.retention_verification(integer)')), 'absent') as shape
  union all
  select 'frontend_business_checks_check1',
    'CHECK (seen_method <> ''visit''::text OR visit_address IS NOT NULL)',
    'CHECK (seen_method <> ''visit''::text OR visit_address IS NOT NULL OR decided_at IS NOT NULL)',
    -- The rollback can leave the earlier rule NOT VALID: still the earlier
    -- rule. A NOT VALID copy of the update's rule is neither (the update
    -- refuses it).
    coalesce((select case pg_get_constraintdef(c.oid, true)
        when 'CHECK (seen_method <> ''visit''::text OR visit_address IS NOT NULL) NOT VALID'
          then 'CHECK (seen_method <> ''visit''::text OR visit_address IS NOT NULL)'
        else pg_get_constraintdef(c.oid, true) end from pg_constraint c
      where c.conrelid = 'private.frontend_business_checks'::regclass
        and c.conname = 'frontend_business_checks_check1'), 'absent')
),
state as (
  select bool_and(shape = reviewed) as absent, bool_and(shape = updated) as applied from shapes
),
problems as (
  select 'problem' as kind,
    item || ' is neither the reviewed body nor the update''s (' || shape || '); do not apply the update' as detail
  from shapes where shape <> reviewed and shape <> updated
),
checks as (
  select x.id,
    greatest(coalesce(x.revoked_at, x.expires_at, x.decided_at), case when x.kind = 'cipc_link' then
        (select coalesce(root.revoked_at, root.expires_at) from private.frontend_cipc_latest_result l
          join private.frontend_cipc_latest_result root on root.business_id = l.linked_business_id
            and root.owner_id = l.owner_id and root.kind = 'cipc' and root.registration_number = l.registration_number
          where l.business_id = x.business_id and l.id = x.id and l.status = 'approved') end)
      < statement_timestamp() - interval '12 months'
      and (not (x.status = 'approved' or x.revoked_at is not null)
        or not exists(select 1 from private.frontend_business_checks o where o.business_id = x.business_id
          and (o.kind = 'seen') = (x.kind = 'seen') and (o.status = 'approved' or o.revoked_at is not null)
          and (o.decided_at, o.id) < (x.decided_at, x.id))) as record_due,
    coalesce(x.revoked_at, x.decided_at) < statement_timestamp() - interval '30 days'
      and (x.visit_address is not null or x.visit_report is not null
        or exists(select 1 from private.frontend_business_seen_photos p where p.check_id = x.id
          and (p.latitude is not null or p.longitude is not null))
        or exists(select 1 from private.frontend_business_check_messages m where m.check_id = x.id)
        or exists(select 1 from private.frontend_cipc_documents d where d.check_id = x.id)
        or exists(select 1 from private.frontend_cipc_reviews r where r.check_id = x.id
          and (r.representative_email is not null or r.callback_record is not null))) as details_due,
    exists(select 1 from private.evidence_fraud_holds h where h.case_id = x.id and h.closed_at is null)
      or exists(select 1 from private.legal_holds h where h.subject_id = x.owner_id and h.released_at is null) as held
  from private.frontend_business_checks x
  where x.decided_at is not null
)
select 'summary' as kind,
  'business check retention: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; details due: ' || (select count(*) from checks where details_due and not record_due and not held)
    || '; records due: ' || (select count(*) from checks where record_due and not held)
    || '; held: ' || (select count(*) from checks where (details_due or record_due) and held) as detail
from state s
union all
select kind, detail from problems;
