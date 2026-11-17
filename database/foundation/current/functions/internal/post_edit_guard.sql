-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_edit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare target uuid;
begin
  if tg_table_name = 'posts' then
    if tg_op = 'INSERT' then
      if new.edit_of is not null and not exists (select 1 from private.posts o where o.id = new.edit_of
          and o.edit_of is null and (o.owner_id, o.kind, o.area, o.category_key)
            = (new.owner_id, new.kind, new.area, new.category_key)) then
        raise exception 'an edit must match its live post' using errcode = '23514';
      end if;
      return new;
    end if;
    if new.edit_of is distinct from old.edit_of
      or (new.edit_of is not null and new.category_key is distinct from old.category_key) then
      raise exception 'an edit stays linked to its live post and category' using errcode = '23514';
    end if;
    if (new.category_key, new.activity_key, new.title, new.description, new.province_id, new.city_id, new.locality_label)
        is distinct from (old.category_key, old.activity_key, old.title, old.description, old.province_id, old.city_id, old.locality_label)
      and exists (select 1 from private.posts e where e.edit_of = new.id) then
      raise exception 'this post has an edit waiting for review' using errcode = '23514';
    end if;
    return new;
  end if;
  foreach target in array case tg_op when 'INSERT' then array[new.post_id] when 'DELETE' then array[old.post_id]
      else array[old.post_id, new.post_id] end loop
    -- A cascade from a deleted post is not an edit.
    if exists (select 1 from private.posts e where e.edit_of = target)
      and exists (select 1 from private.posts p where p.id = target) then
      raise exception 'this post has an edit waiting for review' using errcode = '23514';
    end if;
  end loop;
  return coalesce(new, old);
end;
$function$;
alter function internal.post_edit_guard() owner to postgres;
revoke all on function internal.post_edit_guard() from public;
