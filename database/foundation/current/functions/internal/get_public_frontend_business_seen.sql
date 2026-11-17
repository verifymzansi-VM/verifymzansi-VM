-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_public_frontend_business_seen(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_post_ids is null or cardinality(p_post_ids)>100 or coalesce(array_ndims(p_post_ids),1)<>1
    then raise exception 'bounded represented businesses required' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('business_id',x.business_id,'verified_at',x.decided_at,
    'expires_at',x.expires_at,'method',x.seen_method,'city',x.public_city) order by x.business_id),'[]'::jsonb) into result from (
      select distinct on(c.business_id) c.* from private.frontend_business_checks c
      join private.posts p on p.id=c.business_id and p.owner_id=c.owner_id and p.kind='business'
      join private.public_eligible_posts eligible on eligible.id=p.id
      where c.business_id=any(p_post_ids) and c.kind='seen' and (c.status='approved' or c.revoked_at is not null)
      order by c.business_id,c.decided_at desc,c.id desc)x
    where x.status='approved' and x.expires_at>statement_timestamp() and internal.frontend_business_identity_reviewed(x.owner_id);
  return result;
end$function$;
alter function internal.get_public_frontend_business_seen(uuid[]) owner to postgres;
revoke all on function internal.get_public_frontend_business_seen(uuid[]) from public;
grant execute on function internal.get_public_frontend_business_seen(uuid[]) to anon;
grant execute on function internal.get_public_frontend_business_seen(uuid[]) to authenticated;
