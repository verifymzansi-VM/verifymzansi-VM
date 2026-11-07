-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.org_list_sponsorships(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.organisation_actor(p_org); o private.organisations;
begin
  select * into o from private.organisations where id=p_org;
  return jsonb_build_object('capacity',o.sponsored_capacity,'programme_status',o.programme_status,
    'active',(select count(*) from private.organisation_sponsorships x where x.organisation_id=p_org and x.status='active'),
    'waitlisted',(select count(*) from private.organisation_sponsorships x where x.organisation_id=p_org
      and x.status='waitlisted'),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'affiliation_id',s.affiliation_id,'post_id',s.post_id,
        'business_name',p.title,'sponsor_type',s.sponsor_type,'status',s.status,'starts_at',s.starts_at,
        'ends_at',s.ends_at,'created_at',s.created_at,'ended_at',s.ended_at,'end_reason',s.end_reason)
        order by s.created_at desc,s.id desc),'[]')
      from (select * from private.organisation_sponsorships x where x.organisation_id=p_org
        order by x.created_at desc,x.id desc limit 500) s
      left join private.posts p on p.id=s.post_id));
end;
$function$;
alter function internal.org_list_sponsorships(uuid) owner to postgres;
revoke all on function internal.org_list_sponsorships(uuid) from public;
grant execute on function internal.org_list_sponsorships(uuid) to authenticated;
