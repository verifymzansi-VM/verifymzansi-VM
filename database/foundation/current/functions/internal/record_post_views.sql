-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_post_views(p_post_ids uuid[], p_device uuid, p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  viewer uuid := p_account; salt_today bytea; salt_before bytea; pid uuid; post_owner uuid;
  bases text[]; primary_mark bytea; counted uuid[] := '{}'::uuid[];
begin
  if p_post_ids is null or p_device is null or cardinality(p_post_ids) not between 1 and 20
    or array_position(p_post_ids, null) is not null then
    raise exception 'view details are invalid' using errcode='22023', detail='views_invalid';
  end if;
  -- An account that is not active counts as signed out.
  if viewer is not null and not exists(select 1 from private.current_account_access a where a.id=viewer) then
    viewer := null;
  end if;
  -- Staff views are never counted.
  if viewer is not null and exists(select 1 from private.staff_roles r where r.user_id=viewer and r.revoked_at is null) then
    return jsonb_build_object('counted', '[]'::jsonb);
  end if;
  -- The first view of the day makes its salt and forgets the older ones.
  insert into private.post_view_salts(day, salt)
    values (today, decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex'))
    on conflict (day) do nothing;
  if found then
    delete from private.post_view_salts s where s.day < today - 1;
    delete from private.post_view_marks m where m.seen_at < statement_timestamp() - interval '48 hours';
  end if;
  select s.salt into salt_today from private.post_view_salts s where s.day = today;
  select s.salt into salt_before from private.post_view_salts s where s.day = today - 1;
  -- The account first when signed in: its mark decides whether the view counts.
  bases := case when viewer is null then array['device:'||p_device::text]
    else array['account:'||viewer::text, 'device:'||p_device::text] end;
  for pid in select distinct x from unnest(p_post_ids) x order by 1 loop
    select p.owner_id into post_owner from private.posts p
      join private.post_search_documents d on d.post_id = p.id
      where p.id = pid and d.is_visible and (d.visible_until is null or d.visible_until > statement_timestamp())
        and exists(select 1 from private.public_eligible_posts e where e.id = p.id);
    continue when not found or post_owner = viewer;
    -- Seen in the last 24 hours, under today's or yesterday's salt.
    continue when exists(select 1 from private.post_view_marks m
      where m.seen_at > statement_timestamp() - interval '24 hours'
        and m.mark in (select sha256(salt_today || convert_to(b || '|' || pid::text, 'UTF8')) from unnest(bases) b
          union all
          select sha256(salt_before || convert_to(b || '|' || pid::text, 'UTF8')) from unnest(bases) b
          where salt_before is not null));
    primary_mark := sha256(salt_today || convert_to(bases[1] || '|' || pid::text, 'UTF8'));
    insert into private.post_view_marks(mark) values (primary_mark) on conflict (mark) do nothing;
    -- A view sent twice at once counts once.
    continue when not found;
    insert into private.post_view_marks(mark)
      select sha256(salt_today || convert_to(b || '|' || pid::text, 'UTF8')) from unnest(bases[2:]) b
      on conflict (mark) do nothing;
    insert into private.post_view_days(post_id, day, views) values (pid, today, 1)
      on conflict (post_id, day) do update set views = private.post_view_days.views + 1;
    counted := counted || pid;
  end loop;
  return jsonb_build_object('counted', to_jsonb(counted));
end;
$function$;
alter function internal.record_post_views(uuid[],uuid,uuid) owner to postgres;
revoke all on function internal.record_post_views(uuid[],uuid,uuid) from public;
grant execute on function internal.record_post_views(uuid[],uuid,uuid) to service_role;
