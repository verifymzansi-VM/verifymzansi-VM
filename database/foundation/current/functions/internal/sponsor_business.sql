-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.sponsor_business(p_affiliation uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; f private.organisation_affiliations; o private.organisations; owner uuid; open_count integer;
  s private.organisation_sponsorships;
begin
  perform internal.organisation_reason(p_reason);
  select * into f from private.organisation_affiliations where id=p_affiliation;
  if not found then raise exception 'affiliation not found' using errcode='PT404',detail='affiliation_unavailable'; end if;
  actor:=internal.organisation_actor(f.organisation_id);
  select * into f from private.organisation_affiliations where id=f.id for update;
  select * into o from private.organisations where id=f.organisation_id for update;
  actor:=internal.organisation_actor(o.id);
  if f.status<>'active' then
    raise exception 'affiliation is not active' using errcode='PT409',detail='affiliation_state'; end if;
  if o.programme_status not in('founding_trial','active_paid') then
    raise exception 'programme has no sponsored places' using errcode='PT409',detail='programme_inactive'; end if;
  select p.owner_id into owner from private.posts p where p.id=f.post_id and p.kind='business';
  if owner is null or not exists(select 1 from private.current_account_access u where u.id=owner) then
    raise exception 'business owner unavailable' using errcode='PT409',detail='sponsorship_owner_unavailable'; end if;
  if owner=actor then
    raise exception 'own business cannot be sponsored' using errcode='42501',detail='self_sponsorship'; end if;
  if exists(select 1 from private.organisation_sponsorships x where x.affiliation_id=f.id
      and x.status in('active','waitlisted')) then
    raise exception 'business already sponsored or waiting' using errcode='PT409',detail='sponsorship_exists'; end if;
  select count(*) into open_count from private.organisation_sponsorships x where x.organisation_id=o.id
    and x.status in('active','waitlisted');
  if open_count>=o.sponsored_capacity+500 then
    raise exception 'waiting list is full' using errcode='PT409',detail='sponsorship_waitlist_full'; end if;
  insert into private.organisation_sponsorships(organisation_id,affiliation_id,post_id,owner_id,sponsor_type,requested_by)
    values(o.id,f.id,f.post_id,owner,case o.programme_status when 'founding_trial' then 'founding' else 'organisation' end,
      actor) returning * into s;
  perform internal.record_organisation_event(o.id,actor,'sponsorship_requested',s.id,p_reason);
  perform internal.fill_sponsorship_places(o.id);
  actor:=internal.organisation_actor(o.id);
  select * into s from private.organisation_sponsorships where id=s.id;
  return jsonb_build_object('id',s.id,'status',s.status,'sponsor_type',s.sponsor_type,'ends_at',s.ends_at);
end;
$function$;
alter function internal.sponsor_business(uuid,text) owner to postgres;
revoke all on function internal.sponsor_business(uuid,text) from public;
grant execute on function internal.sponsor_business(uuid,text) to authenticated;
