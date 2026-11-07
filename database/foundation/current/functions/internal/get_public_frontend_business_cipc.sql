-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_public_frontend_business_cipc(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_post_ids is null or cardinality(p_post_ids)>100 or coalesce(array_ndims(p_post_ids),1)<>1
    then raise exception 'bounded represented businesses required' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('business_id',s.business_id,'verified_at',s.decided_at,'expires_at',s.expires_at,
    'registration_number',s.registration_number,'registered_name',s.registered_name,'role',s.accepted_role,'position',s.position_title,
    'office',case when s.registered_office is not null then
      jsonb_build_object('suburb',s.registered_office->>'suburb','city',s.registered_office->>'city','province',s.registered_office->>'province')||
      case when s.display_full_office then jsonb_build_object('streetLines',coalesce(s.registered_office->'streetLines','[]'::jsonb),
        'postalCode',s.registered_office->>'postalCode') else '{}'::jsonb end end)
    order by s.business_id),'[]'::jsonb) into result
  from private.frontend_current_cipc_stickers s join private.public_eligible_posts p on p.id=s.business_id where s.business_id=any(p_post_ids);
  return result;
end$function$;
alter function internal.get_public_frontend_business_cipc(uuid[]) owner to postgres;
revoke all on function internal.get_public_frontend_business_cipc(uuid[]) from public;
grant execute on function internal.get_public_frontend_business_cipc(uuid[]) to anon;
grant execute on function internal.get_public_frontend_business_cipc(uuid[]) to authenticated;
