-- Public display fields for the posting forms batch. The forms now collect
-- new optional details, stored in each post's presentation as before (no new
-- table, column, command or argument). The public card read returns only the
-- keys listed in internal.public_post_presentation_data, so this update lists
-- the new ones, and the public pages can show them:
-- - business_details.visitor_features (Business: parking, wheelchair access,
--   kid-friendly);
-- - category_details price_from_cents, price_unit, sleeps, bedrooms, beds,
--   bathrooms, backup_utilities, cancellation_free_days and opening_hours
--   (Tourism: "From R___ per night", stay sizes, backup power and water,
--   cancellation days, an attraction's opening hours);
-- - event_details doors_open, refund_policy, refund_days, ticket_sales and
--   gate_payment (Events).
-- Market details live in source_attributes, website and social_links, which
-- the list already returns whole, so they need nothing here.
--
-- Business "Show number" (item 6 of the batch, Call and WhatsApp use the
-- verified number): internal.reveal_post_phone, full body. For a Business or
-- Tourism business post it now returns the owner's current verified number
-- (private.verification_phone_proofs, as listings and events already do) for
-- a channel the post switched on, instead of the number stored with the post.
-- Whether a channel is on is decided as before
-- (internal.business_contact_number on the stored presentation), so the
-- public contact options do not change. A post whose owner has no verified
-- number reveals nothing. The website now stores only the verified number.
--
-- Expand only: two replaced function bodies (the earlier list plus the new
-- keys; the reveal's business branch); no command, argument, grant, table or
-- stored row changes.
-- ORDER: apply first. The website asks nothing new; until the new forms are
-- live, no post holds the new keys, so the public pages are unchanged. A
-- business post saved with a number other than its owner's verified one
-- reveals the verified number from the moment this update is applied.
-- It refuses with 55000 unless internal.public_post_presentation_data and
-- internal.reveal_post_phone have their reviewed bodies (or this update's).
-- Read-only preflight: ../preflight/20261128012529_posting_form_display_fields.check.sql.
-- Rollback: ../rollback/20261128012529_posting_form_display_fields.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare item record;
begin
  for item in select v.sig,v.allowed,(select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) as body
    from (values
      ('internal.public_post_presentation_data(text,jsonb)',array['0edd179a32830a17a051195629ce8497','a07fefcadbed5f09ec48986f583008df']),
      ('internal.reveal_post_phone(uuid,text)',array['a30f22dd9c40c95cdc35abb9dcf5e204','8694f1646d929efbdacd0cb129b1b1bd'])) v(sig,allowed)
  loop
    if item.body is null or not item.body=any(item.allowed) then
      raise exception 'posting form display fields precondition: % is not the reviewed body (%)',item.sig,coalesce(item.body,'absent')
        using errcode='55000';
    end if;
  end loop;
end$$;

create or replace function internal.public_post_presentation_data(p_kind text, p_data jsonb)
returns jsonb language sql immutable set search_path to pg_catalog as $function$
 select coalesce(jsonb_object_agg(f.key,f.value),'{}'::jsonb) from (
   select e.key,case e.key
     when 'business_details' then internal.json_object_keys_only(e.value,array[
       'type','mall_name','mall_address','mall_summary','mall_photos','floor_or_wing','nearest_entrance',
       'parking_notes','street_address','suburb','landmark','walk_in_policy','building_name','suite_or_unit',
       'service_suburb','appointment_required','customer_pickup_allowed','visitor_notes','travel_radius_km',
       'callout_fee_from','emergency_callouts','primary_order_channel','order_url','delivery_regions',
       'support_response_time','market_name','stall_label','trading_days','trading_hours'
       ,'visitor_features'])
       - case when h.hidden then array['street_address','suite_or_unit'] else array[]::text[] end
     when 'category_details' then (select c.v-array['customer_access','business_profile']
         || case when a.v is null then '{}'::jsonb else jsonb_build_object('customer_access',a.v) end
         || case when b.v is null then '{}'::jsonb else jsonb_build_object('business_profile',b.v) end
       from (select internal.json_object_keys_only(e.value,array[
         'contact_methods','customer_access','business_profile','venue_photos','meeting_point','subcategory',
         'practice_number','medical_aid_accepted','accepted_medical_aids','brands_serviced','roadside_assistance',
         'registration_body','registration_number','virtual_consultations','accreditation','age_range',
         'dietary_options','seating_capacity','byob_allowed','halal_certified','liquor_license','emergency_callout',
         'free_quotes','star_rating','number_of_rooms','accommodation_types','check_in_time','check_out_time',
         'price_range','amenities','meal_options','languages_spoken','cancellation_policy','booking_url',
         'tgcsa_grading','minimum_stay_nights','child_policy','nearby_attractions','seasonal_pricing',
         'pets_allowed','smoking_allowed','treatment_types','activity_types','tour_duration','max_group_size',
         'difficulty_level','equipment_provided','whats_included','age_restriction','guided_tours','audio_guide',
         'visit_duration','services_offered','specializations','vehicle_types','delivery_collection',
         'min_driver_age','insurance_included','gps_available'
         ,'price_from_cents','price_unit','sleeps','bedrooms','beds','bathrooms','backup_utilities',
         'cancellation_free_days','opening_hours']) v) c
       cross join lateral (select internal.json_object_keys_only(c.v->'customer_access',array[
         'version','methods','premises','venue','serviceAreas','deliveryAreas','nationwide','publishAddress']) v) a
       cross join lateral (select internal.json_object_keys_only(c.v->'business_profile',array[
         'year_established','bbbee_level','languages_spoken','load_shedding_ready','number_of_employees']) v) b)
     when 'event_details' then internal.json_object_keys_only(e.value,array[
       'event_type','venue_name','venue_capacity','ticket_tiers','tickets_url','website','map_directions',
       'social_links','age_restriction','dress_code','lineup','parking_available','accessibility',
       'food_drinks_available','bring_your_own','recurring','rain_policy','early_bird_deadline',
       'group_discount_available'
       ,'doors_open','refund_policy','refund_days','ticket_sales','gate_payment'])
     else e.value end as value
   from jsonb_each(case when jsonb_typeof(p_data)='object' then p_data else '{}'::jsonb end) e
   cross join (select p_kind='business' and p_data#>'{category_details,customer_access}' is not null
       and p_data#>'{category_details,customer_access,publishAddress}' is distinct from 'true'::jsonb as hidden) h
   where e.key=any(array['slug','location_town','location_address','store_number','map_directions','website',
       'social_links','services_offered','service_areas','business_details','category_details','operating_hours',
       'payment_methods_accepted','delivery_options','layout_template','event_details','business_id',
       'category_key','source_attributes','layout_width','layout_height','media_width','media_height',
       'ticket_price_cents','category_label'])
     and not (p_kind='listing' and e.key='location_address')
     and not (h.hidden and e.key in('location_address','store_number','map_directions'))
 ) f where f.value is not null;
$function$;
alter function internal.public_post_presentation_data(text,jsonb) owner to postgres;
revoke all on function internal.public_post_presentation_data(text,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.reveal_post_phone(p_post_id uuid, p_channel text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare number text; post_kind text;
begin
  if p_channel is null or p_channel not in('call','whatsapp') then raise exception 'invalid channel' using errcode='22023'; end if;
  select p.kind::text into post_kind from private.public_eligible_posts eligible join private.posts p on p.id=eligible.id
    where p.id=p_post_id;
  if post_kind is null then return null; end if;
  if post_kind='business' then
    -- A channel the business switched on shows the owner's current verified
    -- number (the same phone proof as listings and events), so a changed
    -- verified number reaches every business post at once.
    select f.phone into number from private.post_presentations d
      join private.posts p on p.id=d.post_id
      join private.verification_phone_proofs f on f.owner_id=p.owner_id and f.revoked_at is null
      where d.post_id=p_post_id and internal.business_contact_number(d.data,d.contacts,p_channel) is not null;
    return number;
  end if;
  select f.phone into number from private.public_eligible_posts eligible join private.posts p on p.id=eligible.id
    join private.post_contacts c on c.post_id=p.id and p_channel=any(c.channels)
    join private.verification_phone_proofs f on f.owner_id=p.owner_id and f.revoked_at is null
    where p.id=p_post_id;
  return number;
end;
$function$;
alter function internal.reveal_post_phone(uuid,text) owner to postgres;
revoke all on function internal.reveal_post_phone(uuid,text) from public;
grant execute on function internal.reveal_post_phone(uuid,text) to service_role;

commit;
