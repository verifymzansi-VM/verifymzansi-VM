-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.validate_attribute_value(p_rule jsonb, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.validate_attribute_value(jsonb,jsonb) owner to postgres;
revoke all on function internal.validate_attribute_value(jsonb,jsonb) from public;
