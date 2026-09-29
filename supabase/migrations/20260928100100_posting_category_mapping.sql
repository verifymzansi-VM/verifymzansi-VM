-- Only known activities are reclassified. Ambiguous profiles retain their legacy category.
-- Run after 20260928100000 has committed. Safe to run again.
UPDATE public.businesses
SET category_details = COALESCE(category_details, '{}'::jsonb) || jsonb_build_object('previous_category', category::text),
    category = (CASE subcategory
  WHEN 'doctor_medical' THEN 'health_medical'
  WHEN 'dentist' THEN 'health_medical'
  WHEN 'optometrist' THEN 'health_medical'
  WHEN 'pharmacy' THEN 'health_medical'
  WHEN 'physio_chiro' THEN 'health_medical'
  WHEN 'traditional_healer' THEN 'health_medical'
  WHEN 'mental_health' THEN 'health_medical'
  WHEN 'hair_salon_barber' THEN 'beauty_personal'
  WHEN 'beauty_nail_salon' THEN 'beauty_personal'
  WHEN 'spa_wellness' THEN 'fitness_wellness'
  WHEN 'gym_fitness' THEN 'fitness_wellness'
  WHEN 'cleaning_service' THEN 'cleaning_garden'
  WHEN 'landscaping' THEN 'cleaning_garden'
  WHEN 'pest_control' THEN 'cleaning_garden'
  WHEN 'courier_logistics' THEN 'transport_storage'
  WHEN 'shuttle_transport' THEN 'transport_storage'
  WHEN 'storage_warehousing' THEN 'transport_storage'
  WHEN 'driving_school_auto' THEN 'education_training'
  WHEN 'printing_signage' THEN 'professional_services'
  WHEN 'pet_services' THEN 'pets_animals'
  WHEN 'religious_org' THEN 'community_personal'
  WHEN 'ngo_npo' THEN 'community_personal'
  WHEN 'funeral_services' THEN 'community_personal'
  WHEN 'bakery_retail' THEN 'food_dining'
  ELSE category::text END)::public.business_category
WHERE subcategory IN ('doctor_medical', 'dentist', 'optometrist', 'pharmacy', 'physio_chiro', 'traditional_healer', 'mental_health', 'hair_salon_barber', 'beauty_nail_salon', 'spa_wellness', 'gym_fitness', 'cleaning_service', 'landscaping', 'pest_control', 'courier_logistics', 'shuttle_transport', 'storage_warehousing', 'driving_school_auto', 'printing_signage', 'pet_services', 'religious_org', 'ngo_npo', 'funeral_services', 'bakery_retail')
AND category::text <> (CASE subcategory
  WHEN 'doctor_medical' THEN 'health_medical'
  WHEN 'dentist' THEN 'health_medical'
  WHEN 'optometrist' THEN 'health_medical'
  WHEN 'pharmacy' THEN 'health_medical'
  WHEN 'physio_chiro' THEN 'health_medical'
  WHEN 'traditional_healer' THEN 'health_medical'
  WHEN 'mental_health' THEN 'health_medical'
  WHEN 'hair_salon_barber' THEN 'beauty_personal'
  WHEN 'beauty_nail_salon' THEN 'beauty_personal'
  WHEN 'spa_wellness' THEN 'fitness_wellness'
  WHEN 'gym_fitness' THEN 'fitness_wellness'
  WHEN 'cleaning_service' THEN 'cleaning_garden'
  WHEN 'landscaping' THEN 'cleaning_garden'
  WHEN 'pest_control' THEN 'cleaning_garden'
  WHEN 'courier_logistics' THEN 'transport_storage'
  WHEN 'shuttle_transport' THEN 'transport_storage'
  WHEN 'storage_warehousing' THEN 'transport_storage'
  WHEN 'driving_school_auto' THEN 'education_training'
  WHEN 'printing_signage' THEN 'professional_services'
  WHEN 'pet_services' THEN 'pets_animals'
  WHEN 'religious_org' THEN 'community_personal'
  WHEN 'ngo_npo' THEN 'community_personal'
  WHEN 'funeral_services' THEN 'community_personal'
  WHEN 'bakery_retail' THEN 'food_dining' ELSE category::text END);
UPDATE public.businesses
SET category_details = COALESCE(category_details, '{}'::jsonb) || jsonb_build_object('previous_category', category::text),
    category = 'automotive_services'
WHERE category::text = 'automotive_transport' AND subcategory IN ('car_dealer_new','car_dealer_used','mechanic_workshop','panel_beater','auto_electrician','tyre_shop','car_wash','car_audio_accessories','towing_service');
UPDATE public.businesses SET subcategory = 'driving_school' WHERE subcategory = 'driving_school_auto';
UPDATE public.businesses SET subcategory = 'bakery_patisserie' WHERE subcategory = 'bakery_retail';

-- Preserve all listing attributes, IDs, owners and moderation state. Only these
-- explicit item choices identify a new parent without guessing.
UPDATE public.listings
SET attributes = COALESCE(attributes, '{}'::jsonb) || jsonb_build_object('previous_category', category::text),
    category = (CASE attributes->>'sub_category'
      WHEN 'clothing' THEN 'clothing_accessories'
      WHEN 'sports_outdoor' THEN 'sports_hobbies'
      WHEN 'musical_instruments' THEN 'sports_hobbies'
      WHEN 'books_stationery' THEN 'sports_hobbies'
      WHEN 'other' THEN 'other_items'
      ELSE category::text END)::public.listing_category
WHERE category::text = 'home_lifestyle'
  AND attributes->>'sub_category' IN ('clothing', 'sports_outdoor', 'musical_instruments', 'books_stationery', 'other');
