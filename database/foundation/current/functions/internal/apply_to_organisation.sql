-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.apply_to_organisation(p_org uuid, p_programme uuid, p_post_id uuid, p_reason text, p_member_reference text, p_share_representative_name boolean, p_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); o private.organisations; post private.posts;
  app private.organisation_applications;
begin
  if p_consent is distinct from true or p_share_representative_name is null then
    raise exception 'consent to share the listed details is required' using errcode='22023',detail='consent_required'; end if;
  select * into post from private.posts where id=p_post_id and owner_id=actor and kind='business' and edit_of is null
    and status not in('archived') for share;
  if not found then
    raise exception 'choose one of your business profiles' using errcode='PT404',detail='business_unavailable'; end if;
  select * into o from private.organisations where id=p_org for share;
  if not found or not internal.organisation_listed(o) or not o.accepting_applications then
    raise exception 'this organisation is not accepting requests' using errcode='PT409',detail='applications_closed'; end if;
  actor:=internal.price_draft_actor();
  if p_programme is not null and not exists(select 1 from private.organisation_programmes pr
      where pr.id=p_programme and pr.organisation_id=o.id and pr.active) then
    raise exception 'programme not found' using errcode='PT404',detail='programme_unavailable'; end if;
  if exists(select 1 from private.organisation_affiliations f where f.organisation_id=o.id and f.post_id=post.id
      and f.status='active') then
    raise exception 'this business is already affiliated' using errcode='PT409',detail='already_affiliated'; end if;
  if (select count(*) from private.organisation_applications a where a.applicant_id=actor
      and a.created_at>statement_timestamp()-interval '1 day')>=10 then
    raise exception 'too many requests today' using errcode='PT429',detail='application_limit'; end if;
  begin
    insert into private.organisation_applications(organisation_id,programme_id,post_id,applicant_id,reason,
      member_reference,share_representative_name,consented_at)
    values(o.id,p_programme,post.id,actor,p_reason,p_member_reference,p_share_representative_name,statement_timestamp())
    returning * into app;
  exception when unique_violation then
    raise exception 'a request for this organisation is already open' using errcode='PT409',detail='application_open';
  when check_violation then
    raise exception 'request details are invalid' using errcode='22023',detail='application_invalid';
  end;
  perform internal.notify_account(a.account_id,'organisation_application_received',app.id,post.id,o.id)
    from private.organisation_admins a where a.organisation_id=o.id;
  return jsonb_build_object('id',app.id,'status',app.status);
end;
$function$;
alter function internal.apply_to_organisation(uuid,uuid,uuid,text,text,boolean,boolean) owner to postgres;
revoke all on function internal.apply_to_organisation(uuid,uuid,uuid,text,text,boolean,boolean) from public;
grant execute on function internal.apply_to_organisation(uuid,uuid,uuid,text,text,boolean,boolean) to authenticated;
