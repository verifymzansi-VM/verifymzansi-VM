-- Read-only preflight for updates/20261109073519_post_lifecycle_guards.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update. It changes nothing: the first statement makes the transaction read
-- only, so Postgres refuses any write. The result has one "summary" row with
-- counts, then one row per problem. Apply the update only when the summary is
-- the only row.
--
-- (a) The update backfills every expired, sold or archived post. That makes
--     Postgres re-run the posts table's deferred checks on those rows when the
--     update commits: exactly one detail row, the job salary price rule and the
--     listing attribute rules. A row failing any of them would roll the whole
--     update back, so they are run here first.
-- (b) Open staff holds on ended posts are listed for review: such posts keep
--     their content and media until a reviewer releases the hold.
do $$
declare
  r record;
  failures jsonb := '[]'::jsonb;
begin
  set transaction read only;
  for r in
    select p.id, p.category_key, d.attributes
    from private.posts p join private.listing_details d on d.post_id = p.id
    where p.kind = 'listing' and p.status in ('expired', 'sold', 'archived')
  loop
    begin
      perform internal.validate_listing_attributes(r.category_key, r.attributes, false);
    exception when others then
      failures := failures || jsonb_build_object('post_id', r.id, 'detail', sqlerrm);
    end;
  end loop;
  perform set_config('vm.lifecycle_guards_preflight', failures::text, false);
end$$;

select * from (
  select 0 as sort, 'summary' as problem, null::text as post_id,
    format('%s ended posts to backfill; %s open staff holds; %s event submissions to copy',
      (select count(*) from private.posts where status in ('expired', 'sold', 'archived')),
      (select count(*) from private.frontend_content_holds where released_at is null),
      (select count(*) from private.posts where kind = 'event' and edit_of is null
         and submitted_at > statement_timestamp() - interval '31 days')) as detail
  union all
  select 1, 'deferred check: exactly one detail row', p.id::text, p.kind || ', ' || p.status
  from private.posts p
  where p.status in ('expired', 'sold', 'archived')
    and (select count(*) from private.listing_details d where d.post_id = p.id)
      + (select count(*) from private.business_details d where d.post_id = p.id)
      + (select count(*) from private.event_details d where d.post_id = p.id) <> 1
  union all
  select 2, 'deferred check: job salary cannot be free or negotiable', p.id::text, p.status
  from private.posts p join private.listing_details d on d.post_id = p.id
  where p.kind = 'listing' and p.category_key = 'jobs_services'
    and p.status in ('expired', 'sold', 'archived')
    and (d.price_mode = 'free' or d.price_negotiable)
  union all
  select 3, 'deferred check: listing attributes', f->>'post_id', f->>'detail'
  from jsonb_array_elements(coalesce(nullif(current_setting('vm.lifecycle_guards_preflight', true), ''), '[]')::jsonb) f
  union all
  select 4, 'open staff hold on an ended post', h.post_id::text, 'hold ' || h.id || ', post ' || p.status
  from private.frontend_content_holds h join private.posts p on p.id = h.post_id
  where h.released_at is null and p.status in ('expired', 'sold', 'archived')
) checks
order by sort, post_id;
