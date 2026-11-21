-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.read_identity_disclosure(p_disclosure uuid, p_purpose text, p_subject uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('identity:disclose'); d private.identity_disclosures; records jsonb;
begin
  if p_purpose is null or p_purpose not in ('view','print','selfie') then
    raise exception 'valid purpose required' using errcode='22023',detail='disclosure_purpose_invalid'; end if;
  if p_disclosure is null or (p_purpose='selfie')<>(p_subject is not null) then
    raise exception 'valid disclosure required' using errcode='22023',detail='disclosure_subject_invalid'; end if;
  d:=internal.identity_disclosure_open_for(p_disclosure,actor);
  if p_subject is not null and (d.outcome<>'record' or not p_subject=any(d.subject_ids)) then
    raise exception 'valid disclosure required' using errcode='22023',detail='disclosure_subject_invalid'; end if;
  -- The look is logged before anything is answered.
  insert into private.identity_disclosure_events(disclosure_id,staff_id,kind,subject_id)
    values(d.id,actor,case p_purpose when 'view' then 'viewed' when 'print' then 'printed' else 'selfie_viewed' end,p_subject);
  select coalesce(jsonb_agg(internal.identity_disclosure_record(d,u.subject) order by u.ord),'[]'::jsonb) into records
    from unnest(d.subject_ids) with ordinality u(subject,ord)
    where p_subject is null or u.subject=p_subject;
  perform internal.staff_actor('identity:disclose');
  return jsonb_build_object(
    'disclosure',jsonb_build_object('id',d.id,'number',d.number,'opened_at',d.opened_at,'closes_at',d.closes_at,
      'opened_by_name',(select internal.profile_public_name(p.display_name) from private.profiles p where p.account_id=d.opened_by),
      'request_type',d.request_type,'reference',d.request_reference,'requested_by',d.requested_by,
      'request_date',d.request_date,'reason',d.reason,'lookup_kind',d.lookup_kind,
      'lookup_value',case when d.lookup_kind='id_number' then null else d.lookup_value end,
      'outcome',d.outcome,'match_count',d.match_count),
    'records',records);
end;
$function$;
alter function internal.read_identity_disclosure(uuid,text,uuid) owner to postgres;
revoke all on function internal.read_identity_disclosure(uuid,text,uuid) from public;
grant execute on function internal.read_identity_disclosure(uuid,text,uuid) to authenticated;
