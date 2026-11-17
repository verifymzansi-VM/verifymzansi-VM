-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.public_post_sponsorships(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_post_ids is null or cardinality(p_post_ids) not between 1 and 100 then
    raise exception 'between 1 and 100 post ids required' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('post_id',s.post_id,'organisation_slug',o.slug,
      'organisation_name',o.name,'label',o.sponsorship_wording) order by s.post_id,o.name),'[]')
    from private.organisation_sponsorships s
    join private.organisations o on o.id=s.organisation_id
    join private.public_eligible_posts e on e.id=s.post_id
    where s.post_id=any(p_post_ids) and s.status='active' and s.starts_at<=statement_timestamp()
      and s.ends_at>statement_timestamp() and internal.organisation_listed(o));
end;
$function$;
alter function internal.public_post_sponsorships(uuid[]) owner to postgres;
revoke all on function internal.public_post_sponsorships(uuid[]) from public;
grant execute on function internal.public_post_sponsorships(uuid[]) to anon;
grant execute on function internal.public_post_sponsorships(uuid[]) to authenticated;
