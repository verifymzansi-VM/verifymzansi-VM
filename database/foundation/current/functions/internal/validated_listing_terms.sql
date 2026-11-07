-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.validated_listing_terms(p_category_key text, p_terms jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare price jsonb; mode text; cents numeric; negotiable boolean;
begin
  if p_category_key is null or p_category_key not in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items') then
    raise exception 'invalid price category' using errcode='22023';
  end if;
  if jsonb_typeof(p_terms) is distinct from 'object' or octet_length(p_terms::text)>512
    or not(array(select jsonb_object_keys(p_terms)) <@ array['price','negotiable']) then
    raise exception 'invalid price terms' using errcode='22023';
  end if;
  price:=p_terms->'price';
  if jsonb_typeof(price) is distinct from 'object' or jsonb_typeof(price->'mode') is distinct from 'string'
    or (p_terms ? 'negotiable' and jsonb_typeof(p_terms->'negotiable') is distinct from 'boolean') then
    raise exception 'explicit price required' using errcode='22023';
  end if;
  mode:=price->>'mode'; negotiable:=coalesce((p_terms->>'negotiable')::boolean,false);
  if mode='amount' then
    if not(array(select jsonb_object_keys(price)) <@ array['mode','amount_cents']) or jsonb_typeof(price->'amount_cents') is distinct from 'number' then
      raise exception 'invalid amount fields' using errcode='22023';
    end if;
    cents:=(price->>'amount_cents')::numeric;
    if cents not between 1 and 9999999900 or mod(cents,1)<>0 then
      raise exception 'invalid amount' using errcode='22023';
    end if;
  elsif mode in ('free','on_request') then
    if not(array(select jsonb_object_keys(price)) <@ array['mode']) then
      raise exception 'hidden amount prohibited' using errcode='22023';
    end if;
    cents:=case when mode='free' then 0 else null end;
  else raise exception 'invalid price mode' using errcode='22023';
  end if;
  if (p_category_key='jobs_services' and (mode='free' or negotiable)) or (mode='free' and negotiable) then
    raise exception 'invalid category price terms' using errcode='22023';
  end if;
  return jsonb_build_object('price_mode',mode,'price_cents',cents::bigint,'price_negotiable',negotiable);
end;
$function$;
alter function internal.validated_listing_terms(text,jsonb) owner to postgres;
revoke all on function internal.validated_listing_terms(text,jsonb) from public;
