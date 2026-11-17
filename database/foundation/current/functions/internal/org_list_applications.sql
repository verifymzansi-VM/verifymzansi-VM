-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.org_list_applications(p_org uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.organisation_actor(p_org);
begin
  if p_status is not null and p_status not in('submitted','more_info_required','approved','declined','withdrawn') then
    raise exception 'invalid status' using errcode='22023',detail='application_invalid'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'status',a.status,'post_id',a.post_id,
      'business_name',p.title,'category',p.category_key,'province',p.province_id,'city',p.city_id,
      'identity_verified',internal.current_verified_identity(a.applicant_id) is not null,
      'representative_name',case when a.share_representative_name and pr.legal_name_locked_at is not null
        then pr.legal_first_name||' '||pr.legal_last_name end,
      'programme_name',g.name,'reason',a.reason,'member_reference',a.member_reference,
      'info_request',a.info_request,'info_response',a.info_response,'submitted_at',a.created_at,
      'decision_at',a.decision_at,'decision_note',a.decision_note) order by a.created_at desc),'[]')
    from (select * from private.organisation_applications x where x.organisation_id=p_org
      and (p_status is null or x.status=p_status) order by x.created_at desc limit 200) a
    join private.posts p on p.id=a.post_id
    left join private.profiles pr on pr.account_id=a.applicant_id
    left join private.organisation_programmes g on g.id=a.programme_id);
end;
$function$;
alter function internal.org_list_applications(uuid,text) owner to postgres;
revoke all on function internal.org_list_applications(uuid,text) from public;
grant execute on function internal.org_list_applications(uuid,text) to authenticated;
