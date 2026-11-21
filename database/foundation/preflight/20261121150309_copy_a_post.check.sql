-- Read-only preflight for updates/20261121150309_copy_a_post.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.run_retention and
-- internal.frontend_privacy_export_data are the reviewed bodies and the new
-- table and eight new functions are absent (update not applied), or everything
-- is the update's (already applied), and counts:
-- - "draft posts": posts in draft (no edit of a live post);
-- - after the update, "copies": posts made with Copy, and "unfinished copies":
--   those still in draft.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    case when v.sig = 'private.post_copies'
      then case when to_regclass('private.post_copies') is not null then 'table' end
      else (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig))
    end as body
  from (values
    ('internal.run_retention(integer)', '1d51acbc8fb435ac6f9b1f12a9020c2b', '27b281d704dc40daeeb3f97b88a839e9'),
    ('internal.frontend_privacy_export_data(uuid)', 'e543b105fe264d5a683b5c570bf68cb5', '4aa0fa034c5c09e495530b5563ff3008'),
    ('private.post_copies', null, 'table'),
    ('internal.copy_my_post(uuid,uuid)', null, '2195159d14323575798a6ce2421e2c47'),
    ('api.copy_my_post(uuid,uuid)', null, '6e3e0f2b5320f23666814c7b798981a6'),
    ('internal.copy_new_photo_guard()', null, '43f568afc879ca564314f64ae7e3ba6f'),
    ('internal.get_frontend_staff_copy_facts(uuid[])', null, '426567f2fded7296eaf6bf0ca9528495'),
    ('api.get_frontend_staff_copy_facts(uuid[])', null, 'c003659259239c0aed61f88adee6de55'),
    ('internal.purge_copy_drafts(integer)', null, '7eb58b557ed311b33b9087918dc21c9d'),
    ('internal.list_my_copy_drafts()', null, '7e7841deb0d75dbb6112c486a474978c'),
    ('api.list_my_copy_drafts()', null, '9d8551b32781bacb99abbb3ac9656cb9')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is neither the reviewed body nor the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present'
    from state
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and reviewed <> total and updated <> total
)
select 'summary' as kind,
  'copy a post: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; draft posts: ' || (select count(*) from private.posts p where p.status = 'draft' and p.edit_of is null)
    -- The table exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when s.updated = s.total
         then '; copies: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.post_copies', false, true, '')))[1]::text
           || '; unfinished copies: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.post_copies c join private.posts p on p.id = c.post_id'
             || ' where p.status = ''draft''', false, true, '')))[1]::text
         else '' end as detail
from state s
union all
select kind, detail from problems;
