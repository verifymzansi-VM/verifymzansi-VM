-- Staff can remove a display-only sample post, and restore it, without a code
-- change.
--
-- The sample posts themselves are a static catalogue in the website
-- (src/lib/sample-posts/catalogue.ts); the database never holds their text,
-- media or contacts. This update adds only a hide-list keyed by the
-- catalogue slug:
-- 1. private.hidden_sample_posts: one row per removed sample (slug, the staff
--    account that removed it, when). Row level security on, no grants: only
--    the two commands below read or write it. At most 500 rows.
-- 2. api.set_sample_post_hidden(p_slug, p_hidden) (authenticated; staff
--    only): internal.staff_actor('post:moderate'), the same capability and
--    recent second-factor rule as content moderation. p_hidden=true adds the
--    slug (a slug already hidden keeps its first who and when); false removes
--    it. Either way it is idempotent and returns {"slug","hidden","hidden_at"}.
--    A slug that is not 3 to 80 lowercase letters, digits and single hyphens
--    is refused with 22023; a 501st hidden slug with 54000.
-- 3. api.get_hidden_sample_posts() (anon and authenticated, like the price
--    catalogue): {"slugs":[...]}, sorted. Slugs only: never who or when.
--
-- Expand only: a new table and new commands; no existing body, grant or
-- signature changes. The website release from the same pull request reads the
-- hide-list and shows no sample at all when it cannot read it, so the
-- website must not be deployed with samples switched on before this update is
-- applied (they are off by default).
--
-- ORDER: apply after the pull request is merged and before its website
-- release is deployed; after 20261117123240_skipped_email_status.sql in
-- filename order. Read-only preflight:
-- ../preflight/20261117144001_sample_post_hide_list.check.sql.
-- Rollback: ../rollback/20261117144001_sample_post_hide_list.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does.
do $$
declare present integer;
begin
  select (to_regclass('private.hidden_sample_posts') is not null)::integer
    + (to_regprocedure('internal.set_sample_post_hidden(text,boolean)') is not null)::integer
    + (to_regprocedure('api.set_sample_post_hidden(text,boolean)') is not null)::integer
    + (to_regprocedure('internal.get_hidden_sample_posts()') is not null)::integer
    + (to_regprocedure('api.get_hidden_sample_posts()') is not null)::integer
  into present;
  if present not in (0, 5) then
    raise exception 'sample post hide list precondition: % of 5 objects exist', present
      using errcode='55000';
  end if;
end$$;

create table if not exists private.hidden_sample_posts (
  slug text primary key
    check (length(slug) between 3 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  hidden_by uuid references auth.users (id) on delete set null,
  hidden_at timestamptz not null default clock_timestamp()
);
alter table private.hidden_sample_posts owner to postgres;
alter table private.hidden_sample_posts enable row level security;
revoke all on table private.hidden_sample_posts from public, anon, authenticated, service_role;
create index if not exists hidden_sample_posts_hidden_by_idx
  on private.hidden_sample_posts using btree (hidden_by);

CREATE OR REPLACE FUNCTION internal.set_sample_post_hidden(p_slug text, p_hidden boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('post:moderate'); entry private.hidden_sample_posts;
begin
  if p_slug is null or p_hidden is null or length(p_slug) not between 3 and 80
    or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid sample post' using errcode='22023';
  end if;
  if not p_hidden then
    delete from private.hidden_sample_posts h where h.slug = p_slug;
    return jsonb_build_object('slug', p_slug, 'hidden', false, 'hidden_at', null);
  end if;
  -- One writer at a time, so the limit below holds.
  perform pg_advisory_xact_lock(hashtext('private.hidden_sample_posts'));
  select h.* into entry from private.hidden_sample_posts h where h.slug = p_slug;
  if not found then
    if (select count(*) from private.hidden_sample_posts) >= 500 then
      raise exception 'too many hidden sample posts' using errcode='54000';
    end if;
    insert into private.hidden_sample_posts(slug, hidden_by) values (p_slug, actor)
      returning * into entry;
  end if;
  return jsonb_build_object('slug', entry.slug, 'hidden', true, 'hidden_at', entry.hidden_at);
end;
$function$;
alter function internal.set_sample_post_hidden(text,boolean) owner to postgres;
revoke all on function internal.set_sample_post_hidden(text,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.set_sample_post_hidden(text,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.set_sample_post_hidden(p_slug text, p_hidden boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_sample_post_hidden(p_slug, p_hidden);
$function$;
alter function api.set_sample_post_hidden(text,boolean) owner to postgres;
revoke all on function api.set_sample_post_hidden(text,boolean) from public, anon, authenticated, service_role;
grant execute on function api.set_sample_post_hidden(text,boolean) to authenticated;

-- Public, like the price catalogue: slugs only, never who or when.
CREATE OR REPLACE FUNCTION internal.get_hidden_sample_posts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('slugs',
    coalesce((select jsonb_agg(h.slug order by h.slug) from private.hidden_sample_posts h), '[]'::jsonb));
$function$;
alter function internal.get_hidden_sample_posts() owner to postgres;
revoke all on function internal.get_hidden_sample_posts() from public, anon, authenticated, service_role;
grant execute on function internal.get_hidden_sample_posts() to anon;
grant execute on function internal.get_hidden_sample_posts() to authenticated;

CREATE OR REPLACE FUNCTION api.get_hidden_sample_posts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_hidden_sample_posts();
$function$;
alter function api.get_hidden_sample_posts() owner to postgres;
revoke all on function api.get_hidden_sample_posts() from public, anon, authenticated, service_role;
grant execute on function api.get_hidden_sample_posts() to anon;
grant execute on function api.get_hidden_sample_posts() to authenticated;

notify pgrst,'reload schema';
commit;
