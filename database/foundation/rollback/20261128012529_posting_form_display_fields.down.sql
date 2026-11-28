-- Reviewed rollback for updates/20261128012529_posting_form_display_fields.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. The public card read then stops
-- returning the new display keys (the stored presentations keep them).
-- It refuses (55000) unless internal.public_post_presentation_data has the
-- update's bodies, then puts back both earlier bodies byte for byte (Business
-- "Show number" then reveals the number stored with each post again).
begin;
set local lock_timeout='5s';

do $$
declare item record;
begin
  for item in select v.sig,v.applied,(select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) as body
    from (values
      ('internal.public_post_presentation_data(text,jsonb)','a07fefcadbed5f09ec48986f583008df'),
      ('internal.reveal_post_phone(uuid,text)','8694f1646d929efbdacd0cb129b1b1bd')) v(sig,applied)
  loop
    if item.body is distinct from item.applied then
      raise exception 'rollback precondition: the posting form display fields update is not applied as reviewed (% %)',item.sig,coalesce(item.body,'absent')
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
       'support_response_time','market_name','stall_label','trading_days','trading_hours'])
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
         'min_driver_age','insurance_included','gps_available']) v) c
       cross join lateral (select internal.json_object_keys_only(c.v->'customer_access',array[
         'version','methods','premises','venue','serviceAreas','deliveryAreas','nationwide','publishAddress']) v) a
       cross join lateral (select internal.json_object_keys_only(c.v->'business_profile',array[
         'year_established','bbbee_level','languages_spoken','load_shedding_ready','number_of_employees']) v) b)
     when 'event_details' then internal.json_object_keys_only(e.value,array[
       'event_type','venue_name','venue_capacity','ticket_tiers','tickets_url','website','map_directions',
       'social_links','age_restriction','dress_code','lineup','parking_available','accessibility',
       'food_drinks_available','bring_your_own','recurring','rain_policy','early_bird_deadline',
       'group_discount_available'])
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
    -- The business's own number for a ticked channel, in +27 form.
    select internal.business_contact_number(d.data,d.contacts,p_channel)
      into number from private.post_presentations d where d.post_id=p_post_id;
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
