-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_organisation_detail(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare detail jsonb;contacts jsonb;
begin
  perform internal.staff_actor('organisation:manage');
  detail:=internal.staff_get_organisation(p_id);
  if detail is null then return null;end if;
  select coalesce(jsonb_agg(jsonb_build_object('application_id',a.id,
    'phone',p.contacts->>'phone','email',p.data->>'email','website',p.data->>'website')
    order by a.created_at desc,a.id),'[]'::jsonb) into contacts
    from (select x.id,x.post_id,x.created_at from private.organisation_applications x
      where x.organisation_id=p_id and x.status<>'withdrawn'
      order by x.created_at desc,x.id limit 200)a
    join private.public_eligible_posts e on e.id=a.post_id
    join private.post_presentations p on p.post_id=e.id;
  perform internal.staff_actor('organisation:manage');
  return detail||jsonb_build_object('public_contacts',contacts);
end$function$;
alter function internal.get_frontend_staff_organisation_detail(uuid) owner to postgres;
revoke all on function internal.get_frontend_staff_organisation_detail(uuid) from public;
grant execute on function internal.get_frontend_staff_organisation_detail(uuid) to authenticated;
