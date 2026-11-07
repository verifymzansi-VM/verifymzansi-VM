-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_cipc_preview_context(p_owner uuid, p_session uuid, p_business uuid, p_fingerprints text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_fingerprints is null or cardinality(p_fingerprints)>100
    or exists(select 1 from unnest(p_fingerprints) f where f is null or f !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$')
    then raise exception 'bounded document fingerprints required' using errcode='22023';end if;
  if not exists(select 1 from auth.sessions s join private.current_account_access a on a.id=s.user_id
      where s.id=p_session and s.user_id=p_owner and (s.not_after is null or s.not_after>clock_timestamp()))
    or not internal.frontend_business_identity_reviewed(p_owner)
    then raise exception 'reviewed business owner identity required' using errcode='42501';end if;
  select jsonb_build_object('profile_has_address',nullif(btrim(f.data->>'location_address'),'') is not null,
    'director_index',(select (d.n-1)::integer from unnest(p_fingerprints) with ordinality d(value,n)
      join private.accepted_identity_facts i on i.owner_id=p_owner and i.identity_hmac=d.value and i.revoked_at is null
      order by d.n limit 1)) into result
    from private.posts p left join private.post_presentations f on f.post_id=p.id
    where p.id=p_business and p.owner_id=p_owner and p.kind='business' and p.edit_of is null;
  if result is null then raise exception 'business unavailable' using errcode='PT404';end if;
  return result;
end$function$;
alter function internal.get_frontend_cipc_preview_context(uuid,uuid,uuid,text[]) owner to postgres;
revoke all on function internal.get_frontend_cipc_preview_context(uuid,uuid,uuid,text[]) from public;
grant execute on function internal.get_frontend_cipc_preview_context(uuid,uuid,uuid,text[]) to service_role;
