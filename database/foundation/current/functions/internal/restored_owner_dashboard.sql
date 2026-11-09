-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.restored_owner_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb; verification jsonb;
begin
  verification:=internal.get_my_verification_case();
  select jsonb_build_object(
    'version',1,'account_id',actor,'generated_at',statement_timestamp(),
    'verification',verification,
    'profile_facts',jsonb_build_object(
      'legal_name_locked_at',p.legal_name_locked_at,
      'phone_changed_at',phone.contact_changed_at,
      'phone_verified_at',phone.verified_at,
      'identity_reviewed_at',(select f.reviewed_at from private.accepted_identity_facts f
        where f.owner_id=actor and f.revoked_at is null and f.identity_hmac=internal.current_verified_identity(actor)),
      'location_province',province.label,'location_city',city.label,
      'location_confirmed_at',locality.confirmed_at),
    'counts',(select jsonb_build_object(
      'active_listings',count(*) filter(where kind='listing' and status='live' and visible_until>statement_timestamp()),
      'active_events',count(*) filter(where kind='event' and status='live' and visible_until>statement_timestamp()
        and exists(select 1 from private.event_details e where e.post_id=posts.id and e.ends_at>statement_timestamp())),
      'rejected_listings',count(*) filter(where kind='listing' and status='rejected'),
      'pending_listings',count(*) filter(where kind='listing' and status='pending_moderation'),
      'expiring_listings',count(*) filter(where kind='listing' and status='live' and visible_until>statement_timestamp()
        and visible_until<statement_timestamp()+interval '7 days'),
      'expiring_events',count(*) filter(where kind='event' and status='live' and visible_until>statement_timestamp()
        and exists(select 1 from private.event_details e where e.post_id=posts.id and e.ends_at>statement_timestamp()
          and e.ends_at<statement_timestamp()+interval '48 hours')),
      'businesses',count(*) filter(where kind='business' and area='business'),
      'tourism_businesses',count(*) filter(where kind='business' and area='tourism_events'))
      from private.posts posts where owner_id=actor and edit_of is null),
    'unread_leads',(select count(*) from private.enquiries e where e.owner_id=actor and e.status='new'),
    'unread_notifications',(select count(*) from private.notifications n where n.account_id=actor and n.read_at is null),
    'organisation_admin_count',(select count(*) from private.organisation_admins a where a.account_id=actor),
    'posts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',post.id,'title',post.title,'status',post.status,'created_at',post.created_at,
      'updated_at',post.content_updated_at,'expires_at',post.visible_until,
      'area','MZANSI_MARKET','cover_object_key',(select m.object_key from private.post_media pm
        join private.media_objects m on m.id=pm.object_id
        where pm.post_id=post.id and m.owner_id=actor and m.state='ready' and m.kind='image'
        order by (pm.purpose='cover') desc,pm.position,pm.object_id limit 1)
      ) order by post.content_updated_at desc,post.id desc)
      from (select * from private.posts where owner_id=actor and kind='listing' and edit_of is null
        order by content_updated_at desc,id desc limit 10) post),'[]'::jsonb),
    'recent_leads',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'status',e.status,'message',e.message,'buyer_name',e.buyer_name,
      'created_at',e.created_at,'target_id',e.post_id,'target_type',case when post.kind='event' then 'promotion' else post.kind end,
      'title',post.title) order by e.created_at desc,e.id desc)
      from (select * from private.enquiries where owner_id=actor order by created_at desc,id desc limit 3) e
      left join private.posts post on post.id=e.post_id and post.owner_id=actor),'[]'::jsonb),
    -- Only actual active retail plans produce a paid-plan label. Trial,
    -- sponsorship and staff grants are never presented as purchased plans.
    'paid_plans',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'area',case e.area when 'market' then 'MZANSI_MARKET' when 'business' then 'MZANSI_BUSINESS' when 'tourism_events' then 'PROMOTIONS_EVENTS' else null end,
      'label',pay.snapshot->>'label',
      'tier',case when e.slot_capacity>1 then 'enterprise'
        when pay.snapshot->>'duration_days'='180' then 'half_year'
        when pay.snapshot->>'duration_days'='90' then 'quarter'
        when pay.snapshot->>'duration_days'='30' then 'month'
        when pay.snapshot->>'duration_days'='365' then 'year' else null end,
      'status','active') order by e.slot_capacity desc,e.ends_at desc,e.id)
      from private.entitlements e join private.payments pay on pay.id=e.payment_id
      where e.source='retail_paid' and e.status='active' and e.starts_at<=statement_timestamp() and e.ends_at>statement_timestamp()
        and (e.owner_id=actor or exists(select 1 from private.entitlement_members m where m.entitlement_id=e.id and m.member_id=actor))),'[]'::jsonb)
    ) into result from private.profiles p
    left join private.verification_phone_proofs phone on phone.owner_id=p.account_id and phone.revoked_at is null
    left join private.verification_localities locality on locality.owner_id=p.account_id
    left join private.provinces province on province.id=locality.province_id
    left join private.cities city on city.id=locality.city_id and city.province_id=locality.province_id
    where p.account_id=actor;
  if result is null then raise exception 'account profile unavailable' using errcode='42501'; end if;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.restored_owner_dashboard() owner to postgres;
revoke all on function internal.restored_owner_dashboard() from public;
grant execute on function internal.restored_owner_dashboard() to authenticated;
