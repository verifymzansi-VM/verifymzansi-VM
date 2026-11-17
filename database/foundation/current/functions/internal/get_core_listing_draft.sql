-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_core_listing_draft(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,'status',p.status,'revision',p.revision,
    'price_mode',d.price_mode,'price_cents',d.price_cents,'price_negotiable',d.price_negotiable)
    into result from private.posts p join private.listing_details d on d.post_id=p.id
    where p.id=p_id and p.owner_id=actor and p.kind='listing' and p.status='draft'
      and p.category_key in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items');
  return result;
end;
$function$;
alter function internal.get_core_listing_draft(uuid) owner to postgres;
revoke all on function internal.get_core_listing_draft(uuid) from public;
grant execute on function internal.get_core_listing_draft(uuid) to authenticated;
