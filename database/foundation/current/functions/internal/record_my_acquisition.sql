-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_my_acquisition(p_partner_code text, p_organisation_slug text, p_source text, p_campaign text, p_landing_path text, p_referrer_host text, p_utm jsonb, p_first_touch_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); x private.account_acquisitions; partner private.partners;
  org uuid; src text;
begin
  if (p_source is not null and p_source not in('direct','organic','social','paid_campaign','strategic_invite'))
    or (p_partner_code is not null and p_partner_code !~ '^[A-Za-z0-9]{4,16}$')
    or (p_organisation_slug is not null and p_organisation_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    or (p_campaign is not null and p_campaign !~ '^[a-z0-9][a-z0-9_-]{0,79}$')
    or (p_landing_path is not null and (char_length(p_landing_path)>300
      or p_landing_path !~ '^/[A-Za-z0-9/_.~-]*$'))
    or (p_referrer_host is not null and (p_referrer_host !~ '^[a-z0-9-]+([.][a-z0-9-]+)+$'
      or char_length(p_referrer_host)>200))
    or p_utm is null or jsonb_typeof(p_utm)<>'object'
    or exists(select 1 from jsonb_each(p_utm) u where u.key not in('utm_source','utm_medium','utm_campaign',
      'utm_term','utm_content') or jsonb_typeof(u.value)<>'string'
      or not internal.plain_text_valid(u.value #>> '{}',1,100,false)) then
    raise exception 'invalid attribution' using errcode='22023',detail='acquisition_invalid'; end if;
  select * into x from private.account_acquisitions a where a.account_id=actor;
  if found then return jsonb_build_object('source',x.source,'recorded',false); end if;
  if not exists(select 1 from auth.users u where u.id=actor and u.created_at>statement_timestamp()-interval '7 days') then
    return jsonb_build_object('source',null,'recorded',false); end if;
  select * into partner from private.partners p where p.code=upper(p_partner_code) and p.status='active'
    and p.account_id<>actor;
  select o.id into org from private.organisations o where o.slug=p_organisation_slug and internal.organisation_listed(o);
  src:=case when partner.id is not null then 'partner' when org is not null then 'organisation'
    else coalesce(p_source,'direct') end;
  insert into private.account_acquisitions(account_id,source,partner_id,organisation_id,campaign,landing_path,
      referrer_host,utm,first_touch_at)
    values(actor,src,partner.id,org,p_campaign,p_landing_path,p_referrer_host,p_utm,
      case when p_first_touch_at between statement_timestamp()-interval '90 days' and statement_timestamp()
        then p_first_touch_at end)
    on conflict(account_id) do nothing;
  select * into x from private.account_acquisitions a where a.account_id=actor;
  return jsonb_build_object('source',x.source,'recorded',x.recorded_at=statement_timestamp());
end;
$function$;
alter function internal.record_my_acquisition(text,text,text,text,text,text,jsonb,timestamp with time zone) owner to postgres;
revoke all on function internal.record_my_acquisition(text,text,text,text,text,text,jsonb,timestamp with time zone) from public;
grant execute on function internal.record_my_acquisition(text,text,text,text,text,text,jsonb,timestamp with time zone) to authenticated;
