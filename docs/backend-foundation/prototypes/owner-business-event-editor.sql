-- Owner business/event metadata restore only; not complete form or byte access.
create function internal.get_owner_business_event_editor(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object(
    'id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,
    'activity_key',p.activity_key,'status',p.status,'revision',p.revision,'edit_of',p.edit_of,
    'content',jsonb_build_object('title',p.title,'description',p.description,
      'province_id',p.province_id,'city_id',p.city_id,'locality_label',p.locality_label),
    'event_window',case when p.kind='event' then jsonb_build_object(
      'starts_at',to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone',e.timezone) else null end,
    'media',coalesce((select jsonb_agg(jsonb_build_object(
      'object_id',m.id,'kind',m.kind,'state',m.state,'purpose',m.purpose,
      'position',m.position,'width',m.width,'height',m.height,
      'focal_x',m.focal_x,'focal_y',m.focal_y) order by m.purpose,m.position)
      from (select o.id,o.kind,o.state,pm.purpose,pm.position,o.width,o.height,pm.focal_x,pm.focal_y
        from private.post_media pm join private.media_objects o on o.id=pm.object_id
        where pm.post_id=p.id and o.owner_id=actor order by pm.purpose,pm.position limit 101) m),'[]'::jsonb)
  ) into result
  from private.posts p
  join private.categories c on (c.key,c.kind,c.area)=(p.category_key,p.kind,p.area)
  left join private.business_details b on b.post_id=p.id and p.kind='business'
  left join private.event_details e on e.post_id=p.id and p.kind='event'
  where p.id=p_post_id and p.owner_id=actor
    and ((p.kind='business' and b.post_id is not null) or (p.kind='event' and e.post_id is not null));
  -- Inspecting any lifecycle state grants no mutation or media-byte capability.
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_owner_business_event_editor(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_owner_business_event_editor(uuid) to authenticated;
create function api.get_owner_business_event_editor(p_post_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_owner_business_event_editor(p_post_id);
$$;
revoke all on function api.get_owner_business_event_editor(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_owner_business_event_editor(uuid) to authenticated;
