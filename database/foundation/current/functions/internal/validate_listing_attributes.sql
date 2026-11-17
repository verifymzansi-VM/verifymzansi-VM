-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.validate_listing_attributes(p_category text, p_attributes jsonb, p_complete boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare field private.category_fields; result jsonb:='{}'::jsonb; rule jsonb; active boolean;
begin
  if jsonb_typeof(p_attributes) is distinct from 'object' or octet_length(p_attributes::text)>16384 then raise exception 'attribute object required' using errcode='22023'; end if;
  if not exists(select 1 from private.categories c where c.key=p_category and c.kind='listing') then
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
$function$;
alter function internal.validate_listing_attributes(text,jsonb,boolean) owner to postgres;
revoke all on function internal.validate_listing_attributes(text,jsonb,boolean) from public;
