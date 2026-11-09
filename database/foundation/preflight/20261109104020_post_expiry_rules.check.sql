-- Read-only preflight for updates/20261109104020_post_expiry_rules.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, after 20261109073519_post_lifecycle_guards.sql has been applied (it
-- stops with an error otherwise). It changes nothing: the first statement
-- makes the transaction read only, so Postgres refuses any write. The result
-- has one "summary" row with counts, then one row per problem. Apply the
-- update only when the summary is the only row.
--
-- The update gives every expired, sold and archived post, and every event
-- that has not ended its run, a new deletion date. That makes Postgres re-run the posts
-- table's deferred checks on those rows when the update commits: exactly one
-- detail row, the job salary price rule and the listing attribute rules. A
-- row failing any of them would roll the whole update back, so they are run
-- here first.
--
-- The summary says what the update will do: how many ended posts get a
-- deletion date at least 3 days away and how many new notices their owners
-- will get; how many events get their end as deletion date, and how many of
-- those have already ended (deleted 3 days after the update); how many paused
-- posts still hold a slot whose run has already ended (they expire at the
-- lifecycle job's first run, then follow the 3-day rule); how many paused
-- posts hold no slot and keep the 45/60-day idle rule; and how many staff
-- holds are open (those posts are not expired or deleted while held).
do $$
declare
  r record;
  failures jsonb := '[]'::jsonb;
begin
  set transaction read only;
  if to_regclass('private.event_submissions') is null then
    raise exception 'apply 20261109073519_post_lifecycle_guards.sql first';
  end if;
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
  perform set_config('vm.post_expiry_rules_preflight', failures::text, false);
end$$;

select * from (
  select 0 as sort, 'summary' as problem, null::text as post_id,
    format('%s ended posts get a deletion date at least 3 days away (%s new notices); '
      || '%s events get their end as deletion date (%s already over); '
      || '%s paused posts with a slot whose run has ended expire at the first run; '
      || '%s paused posts without a slot keep the idle rule; %s open staff holds',
      (select count(*) from private.posts where status in ('expired', 'sold', 'archived')),
      (select count(*) from private.posts where (status = 'expired' and kind <> 'event') or status = 'sold'),
      (select count(*) from private.posts p join private.event_details e on e.post_id = p.id
         where p.kind = 'event' and p.edit_of is null and p.ended_at is null
           and p.status not in ('expired', 'sold', 'archived')),
      (select count(*) from private.posts p join private.event_details e on e.post_id = p.id
         where p.kind = 'event' and p.edit_of is null and p.ended_at is null
           and p.status not in ('expired', 'sold', 'archived') and e.ends_at <= statement_timestamp()),
      (select count(*) from private.posts p where p.status = 'paused' and p.kind <> 'event'
         and p.visible_until <= statement_timestamp()
         and exists (select 1 from private.post_activations a where a.post_id = p.id and a.released_at is null)
         and not exists (select 1 from private.frontend_content_holds h where h.post_id = p.id and h.released_at is null)),
      (select count(*) from private.posts p where p.status = 'paused'
         and not exists (select 1 from private.post_activations a where a.post_id = p.id and a.released_at is null)),
      (select count(*) from private.frontend_content_holds where released_at is null)) as detail
  union all
  select 1, 'deferred check: exactly one detail row', p.id::text, p.kind || ', ' || p.status
  from private.posts p
  where (p.status in ('expired', 'sold', 'archived')
      or (p.kind = 'event' and p.edit_of is null and p.ended_at is null))
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
  from jsonb_array_elements(coalesce(nullif(current_setting('vm.post_expiry_rules_preflight', true), ''), '[]')::jsonb) f
) checks
order by sort, post_id;
