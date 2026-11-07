-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_business_event_context(p_post_id uuid, p_expected_revision integer, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); post private.posts; c jsonb:=p_patch; w jsonb;
  activity text; starts timestamptz; ends timestamptz; zone text; rev integer;
begin
  -- The original precedes its copy, matching content, moderation and discard.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  if jsonb_typeof(c) is distinct from 'object' or octet_length(c::text)>1024 or c='{}'::jsonb
    or not(array(select jsonb_object_keys(c)) <@ array['activity_key','event_window','business_type']) then
    raise exception 'invalid context patch' using errcode='22023';
  end if;
  select * into post from private.posts p where p.id=p_post_id and p.owner_id=actor for update;
  if not found or post.kind not in ('business','event') then
    raise exception 'business or event not found' using errcode='22023';
  end if;
  if post.status not in ('draft','rejected','paused') then
    raise exception 'this context cannot be edited now' using errcode='22023';
  end if;
  if post.revision<>p_expected_revision then raise exception 'post changed' using errcode='PT409'; end if;
  if c ? 'business_type' then
    if post.kind<>'business' or jsonb_typeof(c->'business_type') not in ('string','null')
      or (c->>'business_type' is not null and c->>'business_type' not in
        ('mall_store','standalone_shop','home_business','mobile_service','online_only','market_stall')) then
      raise exception 'invalid business type' using errcode='22023';
    end if;
    update private.business_details set business_type=c->>'business_type' where post_id=post.id;
    if not found then raise exception 'business detail not found' using errcode='22023'; end if;
  end if;
  activity:=post.activity_key;
  if c ? 'activity_key' then
    if jsonb_typeof(c->'activity_key') not in ('string','null')
      or (c->>'activity_key' is not null and (c->>'activity_key') !~ '^[a-z][a-z0-9_]{0,79}$') then
      raise exception 'invalid activity' using errcode='22023';
    end if;
    activity:=c->>'activity_key';
    if activity is null and exists(select 1 from private.categories k where k.key=post.category_key and k.activity_required)
      or activity is not null and not exists(select 1 from private.category_activities a where a.category_key=post.category_key and a.key=activity) then
      raise exception 'activity does not meet the category rules' using errcode='22023';
    end if;
  end if;
  if c ? 'event_window' then
    w:=c->'event_window';
    if post.kind<>'event' or jsonb_typeof(w) is distinct from 'object' or octet_length(w::text)>512
      or not(array(select jsonb_object_keys(w)) <@ array['starts_at','ends_at','timezone'])
      or jsonb_typeof(w->'starts_at') is distinct from 'string' or jsonb_typeof(w->'ends_at') is distinct from 'string'
      or jsonb_typeof(w->'timezone') is distinct from 'string'
      or (w->>'starts_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
      or (w->>'ends_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' then
      raise exception 'complete event window required' using errcode='22023';
    end if;
    begin
      starts:=(w->>'starts_at')::timestamptz; ends:=(w->>'ends_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid event instant' using errcode='22023';
    end;
    zone:=w->>'timezone';
    if not isfinite(starts) or not isfinite(ends)
      or extract(year from starts at time zone 'UTC') not between 1 and 9999
      or extract(year from ends at time zone 'UTC') not between 1 and 9999
      or starts<>date_trunc('milliseconds',starts) or ends<>date_trunc('milliseconds',ends)
      or ends<=starts or ends-starts>interval '90 days'
      or not exists(select 1 from private.post_event_timezones z where z.name=zone) then
      raise exception 'invalid event window' using errcode='22023';
    end if;
    update private.event_details set starts_at=starts,ends_at=ends,timezone=zone where post_id=post.id;
    if not found then raise exception 'event detail not found' using errcode='22023'; end if;
  end if;
  update private.posts set activity_key=activity,revision=revision+1,content_updated_at=statement_timestamp()
    where id=post.id returning revision into rev;
  perform internal.price_draft_actor();
  return jsonb_build_object('id',post.id,'revision',rev);
end;
$function$;
alter function internal.save_business_event_context(uuid,integer,jsonb) owner to postgres;
revoke all on function internal.save_business_event_context(uuid,integer,jsonb) from public;
grant execute on function internal.save_business_event_context(uuid,integer,jsonb) to authenticated;
