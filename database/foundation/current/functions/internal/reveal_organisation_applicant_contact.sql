-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reveal_organisation_applicant_contact(p_application uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare a private.organisation_applications;result jsonb;
begin
  if p_application is null then raise exception 'application required' using errcode='22023',detail='application_invalid';end if;
  select * into a from private.organisation_applications where id=p_application;
  if not found then raise exception 'application unavailable' using errcode='PT404',detail='application_unavailable';end if;
  perform internal.organisation_actor(a.organisation_id);
  if a.status not in('submitted','more_info_required') then
    raise exception 'contact shown only while the application is pending' using errcode='PT409',detail='application_state';end if;
  select jsonb_build_object('application_id',a.id,'phone',p.contacts->>'phone','email',p.data->>'email','website',p.data->>'website')
    into result from private.public_eligible_posts e join private.post_presentations p on p.post_id=e.id where e.id=a.post_id;
  return coalesce(result,jsonb_build_object('application_id',a.id,'phone',null,'email',null,'website',null));
end$function$;
alter function internal.reveal_organisation_applicant_contact(uuid) owner to postgres;
revoke all on function internal.reveal_organisation_applicant_contact(uuid) from public;
grant execute on function internal.reveal_organisation_applicant_contact(uuid) to authenticated;
