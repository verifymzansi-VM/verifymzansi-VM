-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
revoke all on function internal.set_sample_post_hidden(text,boolean) from public;
grant execute on function internal.set_sample_post_hidden(text,boolean) to authenticated;
