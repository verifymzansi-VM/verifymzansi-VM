-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into private.post_engagement_totals as t (post_id, likes) values (new.post_id, 1)
      on conflict (post_id) do update set likes = t.likes + 1;
    return new;
  end if;
  update private.post_engagement_totals t set likes = greatest(t.likes - 1, 0) where t.post_id = old.post_id;
  return old;
end;
$function$;
alter function internal.post_likes_count() owner to postgres;
revoke all on function internal.post_likes_count() from public;
