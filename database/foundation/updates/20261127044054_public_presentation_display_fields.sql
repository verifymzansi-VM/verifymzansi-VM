-- Limit the public post presentation to display fields. The public card read
-- (api.search_post_cards with frontend_presentation, open to anon and
-- authenticated) returns each post's presentation through
-- internal.frontend_post_presentation. Until now that returned the whole
-- stored presentation (except a Market listing's location_address). From this
-- update it returns only the keys the public pages render
-- (presentedFormFields and presentedVideoLayout in
-- src/lib/foundation/post-presentation.ts, restoredPublicRow in
-- src/lib/foundation/marketplace-read.ts, the business and tourism layouts,
-- and src/lib/foundation/public-enquiry.ts):
-- - internal.public_post_presentation_data(kind, data), new: an allow-list of
--   top-level keys; business_details, category_details (with its
--   customer_access and business_profile) and event_details keep only their
--   listed inner keys. source_attributes is the Market form's attribute set
--   (src/lib/validations/listing.ts, unknown keys stripped) and is kept as it
--   is. email, phone, whatsapp and every other key are never returned.
-- - A Market listing never returns location_address. A business (Business
--   and Tourism) whose category_details.customer_access exists without
--   publishAddress true returns no location_address, store_number,
--   map_directions, business_details.street_address or
--   business_details.suite_or_unit (the forms' own rule,
--   buildBusinessMutationPayload). A business saved before customer access
--   existed keeps its address, as its page shows it today. An event keeps its
--   venue address.
-- - internal.json_object_keys_only(value, keys), new: the listed keys of an
--   object (null for anything else).
-- - internal.frontend_post_presentation, full body: 'data' goes through the
--   allow-list; media and business_contacts are unchanged.
-- The owner's reads and staff review (internal.frontend_owner_post) replace
-- 'data' with the full stored presentation, so they keep every key.
--
-- One-off cleanup: the forms no longer collect an email, so every stored
-- presentation loses its "email" key. For each post it changes, an approval
-- snapshot that matched the post before the cleanup is moved to the post
-- after it, so the cleanup never counts as an unreviewed edit. Removed emails
-- cannot be restored (the rollback does not bring them back).
--
-- Expand only: two new internal functions and one replaced body; no command,
-- argument, grant or table changes.
-- ORDER: apply first. The website asks nothing new, and its parser accepts any
-- data record, so the public pages simply stop receiving keys they discard or
-- do not show. A website that still saves an email (before the form change)
-- keeps it in the owner's view only.
-- It refuses with 55000 unless internal.frontend_post_presentation has its
-- reviewed body (or this update's).
-- Read-only preflight: ../preflight/20261127044054_public_presentation_display_fields.check.sql.
-- Rollback: ../rollback/20261127044054_public_presentation_display_fields.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.frontend_post_presentation(uuid)');
  if body is null or body not in('d57885ae409a1a91b5bc9a71d2a94730','9f279565fc4eca46f6b355313a2271a3') then
    raise exception 'public presentation fields precondition: internal.frontend_post_presentation(uuid) is not the reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

create or replace function internal.json_object_keys_only(p_value jsonb, p_keys text[])
returns jsonb language sql immutable set search_path to pg_catalog as $function$
 select case when jsonb_typeof(p_value)='object' then
   (select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) from jsonb_each(p_value) e where e.key=any(p_keys))
 end;
$function$;
alter function internal.json_object_keys_only(jsonb,text[]) owner to postgres;
revoke all on function internal.json_object_keys_only(jsonb,text[]) from public,anon,authenticated,service_role;

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

CREATE OR REPLACE FUNCTION internal.frontend_post_presentation(p_post uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select jsonb_build_object('data',coalesce((select internal.public_post_presentation_data(p.kind::text,d.data)
      from private.post_presentations d join private.posts p on p.id=d.post_id where d.post_id=p_post),'{}'::jsonb),
   'media',coalesce((select jsonb_agg(jsonb_build_object('purpose',r.purpose,'position',r.position,'object_key',m.object_key,
     'width',m.width,'height',m.height) order by r.purpose,r.position)
     from private.post_presentation_media r join private.media_objects m on m.id=r.object_id
     join private.posts p on p.id=r.post_id and p.owner_id=m.owner_id
     where r.post_id=p_post and m.state='ready' and m.kind='image'),'[]'::jsonb)) || coalesce((select jsonb_build_object('business_contacts',d.contacts)
      from private.post_presentations d join private.posts p on p.id=d.post_id
      where d.post_id=p_post and p.kind='business'),'{}'::jsonb);
$function$;
alter function internal.frontend_post_presentation(uuid) owner to postgres;
revoke all on function internal.frontend_post_presentation(uuid) from public;

-- One-off: no stored presentation keeps an email. An approval snapshot of a
-- changed post that matched it before follows it.
do $$
declare r record; old_digest text; old_structural text;
begin
  for r in select d.post_id from private.post_presentations d where d.data ? 'email' order by d.post_id for update loop
    old_digest:=internal.frontend_post_approval_digest(r.post_id);
    old_structural:=internal.frontend_post_structural_digest(r.post_id);
    update private.post_presentations set data=data-'email' where post_id=r.post_id;
    update private.frontend_post_approval_snapshots s set
        digest=case when s.digest=old_digest then internal.frontend_post_approval_digest(r.post_id) else s.digest end,
        structural_digest=case when s.structural_digest=old_structural then internal.frontend_post_structural_digest(r.post_id) else s.structural_digest end
      where s.post_id=r.post_id and (s.digest=old_digest or s.structural_digest=old_structural);
  end loop;
end$$;

commit;
