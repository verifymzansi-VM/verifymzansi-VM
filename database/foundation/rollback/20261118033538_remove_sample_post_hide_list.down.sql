-- Reviewed rollback for updates/20261118033538_remove_sample_post_hide_list.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It puts back the sample post hide-list exactly as
-- updates/20261117144001_sample_post_hide_list.sql created it: the table
-- private.hidden_sample_posts (empty: the rows the update deleted are not
-- restored), api.set_sample_post_hidden(p_slug, p_hidden) for staff,
-- api.get_hidden_sample_posts() for everyone, the internal functions behind
-- them, and the same owners and grants. No website release since the sample
-- posts were removed calls them. It refuses (55000) unless every part of the
-- hide-list is absent.
begin;
set local lock_timeout='5s';

do $$
begin
  if to_regclass('private.hidden_sample_posts') is not null
    or to_regprocedure('internal.set_sample_post_hidden(text,boolean)') is not null
    or to_regprocedure('api.set_sample_post_hidden(text,boolean)') is not null
    or to_regprocedure('internal.get_hidden_sample_posts()') is not null
    or to_regprocedure('api.get_hidden_sample_posts()') is not null then
    raise exception 'rollback precondition: part of the sample post hide list is still present'
      using errcode='55000';
  end if;
end$$;

create table private.hidden_sample_posts (
  slug text primary key
    check (length(slug) between 3 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  hidden_by uuid references auth.users (id) on delete set null,
  hidden_at timestamptz not null default clock_timestamp()
);
alter table private.hidden_sample_posts owner to postgres;
alter table private.hidden_sample_posts enable row level security;
revoke all on table private.hidden_sample_posts from public, anon, authenticated, service_role;
create index hidden_sample_posts_hidden_by_idx
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
