-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.canonical_post_channels(p_value jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if jsonb_typeof(p_value) is distinct from 'array' then
    raise exception 'contact channels must be an array' using errcode='22023';
  end if;
  if jsonb_array_length(p_value)>4 or exists(select 1 from jsonb_array_elements(p_value) x
    where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('call','whatsapp','form','in_app')) then
    raise exception 'choose supported contact channels' using errcode='22023';
  end if;
  return array(select channel from unnest(array['call','whatsapp','form']) with ordinality c(channel,position)
    where exists(select 1 from jsonb_array_elements_text(p_value) x
      where case when x='in_app' then 'form' else x end=c.channel) order by position);
end;
$function$;
alter function internal.canonical_post_channels(jsonb) owner to postgres;
revoke all on function internal.canonical_post_channels(jsonb) from public;
