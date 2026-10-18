-- Add activity at creation without changing legacy four-argument calls.
-- One DO statement keeps signature/grant replacement atomic and remains
-- composable inside the baseline's rollback-only proof. No CASCADE.
do $activity_migration$
begin
  drop function api.create_core_draft(text,text,text,jsonb);
  drop function internal.create_core_draft(text,text,text,jsonb);

create function internal.create_core_draft(p_kind text,p_area text,p_category_key text,p_detail jsonb,p_activity_key text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post uuid; starts timestamptz; ends timestamptz; tz text; stored_activity text;
begin
  if not exists(select 1 from private.post_category_contracts c where c.category_key=p_category_key and c.kind=p_kind and c.area=p_area) then
    raise exception 'invalid kind area category' using errcode='22023';
  end if;
  if exists(select 1 from private.categories c where c.key=p_category_key and c.activity_required)
    and p_activity_key is null then
    raise exception 'activity required for this category' using errcode='22023';
  end if;
  if p_activity_key is not null and not exists(select 1 from private.category_activities a
    where a.category_key=p_category_key and a.key=p_activity_key) then
    raise exception 'activity does not belong to this category' using errcode='22023';
  end if;
  if jsonb_typeof(p_detail) is distinct from 'object' or octet_length(p_detail::text)>512 then
    raise exception 'invalid detail payload' using errcode='22023';
  end if;
  if p_kind='event' then
    if not(array(select jsonb_object_keys(p_detail)) <@ array['starts_at','ends_at','timezone'])
      or jsonb_typeof(p_detail->'starts_at') is distinct from 'string' or jsonb_typeof(p_detail->'ends_at') is distinct from 'string'
      or jsonb_typeof(p_detail->'timezone') is distinct from 'string'
      or (p_detail->>'starts_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
      or (p_detail->>'ends_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' then
      raise exception 'explicit event window required' using errcode='22023';
    end if;
    starts:=(p_detail->>'starts_at')::timestamptz; ends:=(p_detail->>'ends_at')::timestamptz; tz:=p_detail->>'timezone';
    if not exists(select 1 from private.post_event_timezones z where z.name=tz) then
      raise exception 'supported IANA timezone required' using errcode='22023';
    end if;
  elsif p_detail<>'{}'::jsonb then raise exception 'detail fields not implemented in this identity fixture' using errcode='22023';
  end if;
  -- Draft allowance (DEC-29): 5 plus 1 per post in the owner's current
  -- packages (internal.draft_allowance in publication.sql). Edit copies are
  -- not counted. Never accept a caller-provided limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,417));
  if (select count(*) from private.posts p where p.owner_id=actor and p.status='draft' and p.edit_of is null)
      >=internal.draft_allowance(actor) then
    raise exception 'draft limit reached' using errcode='PT429';
  end if;
  insert into private.posts(owner_id,kind,area,category_key,activity_key) values(actor,p_kind,p_area,p_category_key,p_activity_key) returning id,activity_key into post,stored_activity;
  if p_kind='listing' then insert into private.listing_details(post_id) values(post);
  elsif p_kind='business' then insert into private.business_details(post_id) values(post);
  else insert into private.event_details(post_id,starts_at,ends_at,timezone) values(post,starts,ends,tz); end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id',post,'kind',p_kind,'area',p_area,'category_key',p_category_key,'status','draft','revision',1)
    || case when stored_activity is not null then jsonb_build_object('activity_key',stored_activity) else '{}'::jsonb end;
end;
$$;
revoke all on function internal.create_core_draft(text,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function internal.create_core_draft(text,text,text,jsonb,text) to authenticated;
create function api.create_core_draft(p_kind text,p_area text,p_category_key text,p_detail jsonb,p_activity_key text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.create_core_draft(p_kind,p_area,p_category_key,p_detail,p_activity_key);
$$;
revoke all on function api.create_core_draft(text,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function api.create_core_draft(text,text,text,jsonb,text) to authenticated;

create or replace function internal.get_core_draft(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,'status',p.status,'revision',p.revision)
      || case when p.activity_key is not null then jsonb_build_object('activity_key',p.activity_key) else '{}'::jsonb end
    into result from private.posts p where p.id=p_id and p.owner_id=actor and p.status='draft';
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_core_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_core_draft(uuid) to authenticated;
perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$activity_migration$;
