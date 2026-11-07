-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.my_sponsorships()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'post_id',s.post_id,'business_name',p.title,
      'organisation_slug',o.slug,'organisation_name',o.name,'label',o.sponsorship_wording,'status',s.status,
      'starts_at',s.starts_at,'ends_at',s.ends_at,'ended_at',s.ended_at) order by s.created_at desc,s.id desc),'[]')
    from (select * from private.organisation_sponsorships x where x.owner_id=actor
      and (x.status in('active','waitlisted') or x.ended_at>statement_timestamp()-interval '90 days')
      order by x.created_at desc,x.id desc limit 100) s
    join private.organisations o on o.id=s.organisation_id
    left join private.posts p on p.id=s.post_id);
end;
$function$;
alter function internal.my_sponsorships() owner to postgres;
revoke all on function internal.my_sponsorships() from public;
grant execute on function internal.my_sponsorships() to authenticated;
