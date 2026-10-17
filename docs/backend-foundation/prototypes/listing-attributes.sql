-- Canonical listing attribute persistence. Registry is private, seeded reference data.
alter table private.listing_details add column attributes jsonb not null default '{}'::jsonb
  check (jsonb_typeof(attributes)='object' and octet_length(attributes::text)<=16384),
  add column attributes_version integer not null default 1 references private.reference_catalog_versions(version);

create function internal.validate_attribute_value(p_rule jsonb,p_value jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare kind text:=p_rule->>'type'; text_value text; n numeric; result jsonb:='[]'::jsonb;
  item jsonb; normalized jsonb; units integer; parsed date;
begin
  if p_value is null or jsonb_typeof(p_value)='null' then raise exception 'attribute value required' using errcode='22023'; end if;
  if kind='string' then
    if jsonb_typeof(p_value)<>'string' then raise exception 'string attribute required' using errcode='22023'; end if;
    text_value:=p_value #>> '{}';
    if p_rule ? 'enum' then
      if not(p_rule->'enum' @> jsonb_build_array(text_value)) then raise exception 'invalid attribute choice' using errcode='22023'; end if;
    else
      text_value:=btrim(text_value,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
    end if;
    select coalesce(sum(case when c='' then 0 when octet_length(c)>3 then 2 else 1 end),0) into units from regexp_split_to_table(text_value,'') c;
    if (p_rule ? 'minLength' and units<(p_rule->>'minLength')::integer)
      or (p_rule ? 'maxLength' and units>(p_rule->>'maxLength')::integer) then
      raise exception 'attribute text outside bounds' using errcode='22023';
    end if;
    if p_rule->>'format'='date' then
      if text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(text_value,4)='0000' then raise exception 'valid date required' using errcode='22023'; end if;
      begin parsed:=text_value::date;
      exception when invalid_datetime_format or datetime_field_overflow then raise exception 'valid date required' using errcode='22023'; end;
      if to_char(parsed,'YYYY-MM-DD')<>text_value then raise exception 'valid date required' using errcode='22023'; end if;
    end if;
    return to_jsonb(text_value);
  elsif kind in ('number','integer') then
    if jsonb_typeof(p_value)<>'number' then raise exception 'numeric attribute required' using errcode='22023'; end if;
    n:=(p_value #>> '{}')::numeric;
    if (kind='integer' and mod(n,1)<>0) or (p_rule ? 'minimum' and n<(p_rule->>'minimum')::numeric)
      or (p_rule ? 'maximum' and n>(p_rule->>'maximum')::numeric) then raise exception 'attribute number outside bounds' using errcode='22023'; end if;
    return p_value;
  elsif kind='boolean' then
    if jsonb_typeof(p_value)<>'boolean' then raise exception 'boolean attribute required' using errcode='22023'; end if;
    return p_value;
  elsif kind='array' then
    if jsonb_typeof(p_value)<>'array' then raise exception 'array attribute required' using errcode='22023'; end if;
    if (p_rule ? 'minItems' and jsonb_array_length(p_value)<(p_rule->>'minItems')::integer)
      or (p_rule ? 'maxItems' and jsonb_array_length(p_value)>(p_rule->>'maxItems')::integer) then raise exception 'attribute list outside bounds' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_value) loop
      normalized:=internal.validate_attribute_value(p_rule->'items',item);
      if result @> jsonb_build_array(normalized) then raise exception 'duplicate attribute choice' using errcode='22023'; end if;
      result:=result||jsonb_build_array(normalized);
    end loop;
    return result;
  end if;
  raise exception 'unsupported attribute rule' using errcode='22023';
end;
$$;
revoke all on function internal.validate_attribute_value(jsonb,jsonb) from public,anon,authenticated,service_role;

create function internal.validate_listing_attributes(p_category text,p_attributes jsonb,p_complete boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare field private.category_fields; result jsonb:='{}'::jsonb; rule jsonb; active boolean;
begin
  if jsonb_typeof(p_attributes) is distinct from 'object' or octet_length(p_attributes::text)>16384 then raise exception 'attribute object required' using errcode='22023'; end if;
  if not exists(select 1 from private.categories c where c.key=p_category and c.kind='listing') then
    if not p_complete and p_category='fixture_market' and p_attributes='{}'::jsonb then return p_attributes; end if;
    raise exception 'unknown listing category' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_attributes) k where not exists(select 1 from private.category_fields f where f.category_key=p_category and f.key=k)) then
    raise exception 'unknown attribute key' using errcode='22023';
  end if;
  for field in select f.* from private.category_fields f where f.category_key=p_category order by f.sort_order loop
    active:=field.depends_on is null or (p_attributes ? field.depends_on and
      (field.depends_on_values is null or field.depends_on_values @> jsonb_build_array(p_attributes->>field.depends_on)));
    if not active and p_attributes ? field.key then raise exception 'inactive attribute field' using errcode='22023'; end if;
    if active and field.required and p_complete and not(p_attributes ? field.key) then raise exception 'required attribute missing' using errcode='22023'; end if;
    if active and p_attributes ? field.key then
      rule:=field.validation;
      if field.dynamic_maximum='south_african_year_plus_one' then
        rule:=rule||jsonb_build_object('maximum',extract(year from statement_timestamp() at time zone 'Africa/Johannesburg')::integer+1);
      elsif field.dynamic_maximum is not null then raise exception 'unsupported dynamic attribute rule' using errcode='22023'; end if;
      result:=result||jsonb_build_object(field.key,internal.validate_attribute_value(rule,p_attributes->field.key));
    end if;
  end loop;
  return result;
end;
$$;
revoke all on function internal.validate_listing_attributes(text,jsonb,boolean) from public,anon,authenticated,service_role;

create function internal.listing_attributes_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare category text;
begin
  select p.category_key into category from private.posts p where p.id=new.post_id;
  if new.attributes_version<>1 then raise exception 'unsupported attribute version' using errcode='23514'; end if;
  new.attributes:=internal.validate_listing_attributes(category,new.attributes,false);
  return new;
end;
$$;
revoke all on function internal.listing_attributes_guard() from public,anon,authenticated,service_role;
create trigger listing_attributes_valid before insert or update on private.listing_details for each row execute function internal.listing_attributes_guard();

-- A parent category change must not leave attributes from a different schema.
-- Deferred validation permits an intentional same-transaction replacement.
create function internal.listing_attributes_category_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare post private.posts; attrs jsonb;
begin
  select p.* into post from private.posts p where p.id=new.id for update;
  if not found or post.kind<>'listing' then return null; end if;
  select d.attributes into attrs from private.listing_details d where d.post_id=post.id;
  if found then perform internal.validate_listing_attributes(post.category_key,attrs,false); end if;
  return null;
end;
$$;
revoke all on function internal.listing_attributes_category_guard() from public,anon,authenticated,service_role;
create constraint trigger listing_attributes_category after insert or update on private.posts
  deferrable initially deferred for each row execute function internal.listing_attributes_category_guard();

create function internal.save_listing_attributes(p_post_id uuid,p_expected_revision integer,p_attributes jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post private.posts; normalized jsonb;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  select p.* into post from private.posts p where p.id=p_post_id and p.owner_id=actor and p.kind='listing' for update;
  if not found or post.status not in ('draft','rejected','paused') then raise exception 'editable listing unavailable' using errcode='22023'; end if;
  if post.revision is distinct from p_expected_revision then raise exception 'listing changed' using errcode='PT409'; end if;
  normalized:=internal.validate_listing_attributes(post.category_key,p_attributes,false);
  update private.listing_details set attributes=normalized,attributes_version=1 where post_id=post.id;
  update private.posts set revision=revision+1,content_updated_at=statement_timestamp() where id=post.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id',post.id,'revision',post.revision+1,'attributes_version',1,'attributes',normalized);
end;
$$;
revoke all on function internal.save_listing_attributes(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.save_listing_attributes(uuid,integer,jsonb) to authenticated;
create function api.save_listing_attributes(p_post_id uuid,p_expected_revision integer,p_attributes jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.save_listing_attributes(p_post_id,p_expected_revision,p_attributes); $$;
revoke all on function api.save_listing_attributes(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function api.save_listing_attributes(uuid,integer,jsonb) to authenticated;

create function internal.get_listing_attributes(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'revision',p.revision,'category_key',p.category_key,'attributes_version',d.attributes_version,'attributes',d.attributes)
    into result from private.posts p join private.listing_details d on d.post_id=p.id where p.id=p_post_id and p.owner_id=actor and p.kind='listing';
  return result;
end;
$$;
revoke all on function internal.get_listing_attributes(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_listing_attributes(uuid) to authenticated;
create function api.get_listing_attributes(p_post_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.get_listing_attributes(p_post_id); $$;
revoke all on function api.get_listing_attributes(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_listing_attributes(uuid) to authenticated;
