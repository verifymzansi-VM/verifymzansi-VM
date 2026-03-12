-- ============================================================
-- Backfill category coverage for marketplace discovery surfaces
-- - Reuse existing verified sellers
-- - Insert one live listing per listing category
-- - Insert one live business per business category
-- - Insert one live promotion per business category
-- - Idempotent via deterministic slugs/titles and NOT EXISTS
-- ============================================================

DO $$
DECLARE
  verified_seller_count integer;
BEGIN
  SELECT COUNT(*)
  INTO verified_seller_count
  FROM public.seller_profiles
  WHERE seller_verification_status = 'verified'
    AND account_status = 'active';

  IF verified_seller_count = 0 THEN
    RAISE NOTICE 'Skipping category coverage backfill: no verified active sellers found.';
    RETURN;
  END IF;

  WITH seed_sellers AS (
    SELECT
      user_id,
      row_number() OVER (ORDER BY user_id) AS rn
    FROM public.seller_profiles
    WHERE seller_verification_status = 'verified'
      AND account_status = 'active'
    ORDER BY user_id
    LIMIT 1
  ),
  seller_count AS (
    SELECT COUNT(*) AS total FROM seed_sellers
  ),
  listing_seed_rows AS (
    SELECT
      row_number() OVER () AS seed_rn,
      v.category,
      v.title,
      v.description,
      v.photos,
      v.price_cents,
      v.price_negotiable,
      v.location_province,
      v.location_city,
      v.contact_methods,
      v.condition,
      v.attributes
    FROM (
      VALUES
        (
          'property'::listing_category,
          '[Seed] Family Home in Soweto',
          'Three-bedroom family home with secure parking, fitted kitchen, and easy access to schools and taxis.',
          ARRAY['/images/promo/seed-mall.png']::text[],
          14500000,
          true,
          'Gauteng',
          'Johannesburg',
          ARRAY['call', 'whatsapp']::contact_method[],
          'good',
          '{"property_type":"house","bedrooms":3,"bathrooms":2,"parking_spots":2,"furnished":false}'::jsonb
        ),
        (
          'vehicles'::listing_category,
          '[Seed] Toyota Hilux 2021 2.8 GD-6',
          'Well-kept bakkie with full service history, canopy, tow bar, and long-distance comfort.',
          ARRAY['/images/promo/seed-hilux.png']::text[],
          45000000,
          true,
          'Western Cape',
          'Cape Town',
          ARRAY['call', 'form']::contact_method[],
          'like_new',
          '{"make":"Toyota","model":"Hilux","year":2021,"mileage_km":68500,"transmission":"automatic","fuel_type":"diesel","body_type":"bakkie","colour":"White"}'::jsonb
        ),
        (
          'auto_parts'::listing_category,
          '[Seed] VW Polo Brake Pad Set',
          'Front brake pad set for VW Polo models with fitting guide included and same-day dispatch available.',
          ARRAY['/images/promo/seed-plumber.png']::text[],
          185000,
          false,
          'KwaZulu-Natal',
          'Durban',
          ARRAY['whatsapp']::contact_method[],
          'new',
          '{"part_type":"brakes","compatible_make":"Volkswagen","compatible_model":"Polo","oem_or_aftermarket":"aftermarket"}'::jsonb
        ),
        (
          'electronics'::listing_category,
          '[Seed] Sony PlayStation 5 Bundle',
          'Console bundle with two controllers, charging dock, and recent racing titles already installed.',
          ARRAY['/images/promo/seed-ps5.png']::text[],
          1100000,
          false,
          'Gauteng',
          'Sandton',
          ARRAY['whatsapp', 'call']::contact_method[],
          'like_new',
          '{"device_type":"Gaming Console","brand":"Sony","model_name":"PlayStation 5","storage_gb":825,"warranty_months":8}'::jsonb
        ),
        (
          'home_lifestyle'::listing_category,
          '[Seed] Modern L-Shape Sofa',
          'Comfortable sectional sofa in charcoal fabric, ideal for family lounges or Airbnb refreshes.',
          ARRAY['/images/promo/seed-sofa.png']::text[],
          800000,
          true,
          'KwaZulu-Natal',
          'Durban',
          ARRAY['whatsapp']::contact_method[],
          'good',
          '{"sub_category":"furniture","material":"Fabric"}'::jsonb
        ),
        (
          'jobs_services'::listing_category,
          '[Seed] Weekend Event MC Services',
          'Professional MC available for launches, weddings, and community events with bilingual hosting experience.',
          ARRAY['/images/promo/seed-mall-canalwalk.png']::text[],
          350000,
          true,
          'Eastern Cape',
          'Gqeberha',
          ARRAY['form', 'whatsapp']::contact_method[],
          'good',
          '{"job_type":"freelance","remote":false,"salary_range":"From R3,500 per event"}'::jsonb
        )
    ) AS v(
      category,
      title,
      description,
      photos,
      price_cents,
      price_negotiable,
      location_province,
      location_city,
      contact_methods,
      condition,
      attributes
    )
  )
  INSERT INTO public.listings (
    seller_id,
    area,
    category,
    title,
    description,
    photos,
    price_cents,
    price_negotiable,
    location_province,
    location_city,
    contact_methods,
    condition,
    attributes,
    status,
    published_at
  )
  SELECT
    ss.user_id,
    'MZANSI_MARKET'::marketplace_area,
    l.category,
    l.title,
    l.description,
    l.photos,
    l.price_cents,
    l.price_negotiable,
    l.location_province,
    l.location_city,
    l.contact_methods,
    l.condition,
    l.attributes,
    'live'::listing_status,
    now()
  FROM listing_seed_rows l
  CROSS JOIN seller_count sc
  JOIN seed_sellers ss
    ON ss.rn = ((l.seed_rn - 1) % sc.total) + 1
  WHERE sc.total > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.listings existing
      WHERE existing.seller_id = ss.user_id
        AND existing.category = l.category
        AND existing.title = l.title
    );

  WITH seed_sellers AS (
    SELECT
      user_id,
      row_number() OVER (ORDER BY user_id) AS rn
    FROM public.seller_profiles
    WHERE seller_verification_status = 'verified'
      AND account_status = 'active'
    ORDER BY user_id
    LIMIT 1
  ),
  seller_count AS (
    SELECT COUNT(*) AS total FROM seed_sellers
  ),
  business_seed_rows AS (
    SELECT
      row_number() OVER () AS seed_rn,
      v.slug,
      v.business_name,
      v.business_type,
      v.category,
      v.description,
      v.cover_photo,
      v.location_province,
      v.location_city,
      v.phone,
      v.whatsapp,
      v.email,
      v.website,
      v.services_offered,
      v.service_areas,
      v.business_details
    FROM (
      VALUES
        (
          'seed-fashion-accessories',
          'Seed Nomsa Style Studio',
          'standalone_shop'::business_type,
          'fashion_accessories'::business_category,
          'Locally styled clothing, shoes, and accessories for everyday wear and special occasions.',
          '/images/promo/seed-mall-sandton.png',
          'Gauteng',
          'Johannesburg',
          '+27000001001',
          '+27000001001',
          'fashion.seed@verifymzansi.test',
          NULL,
          ARRAY['Boutique styling', 'Alterations', 'Gift packaging']::text[],
          NULL::jsonb,
          '{"type":"standalone_shop","street_address":"18 Jellicoe Avenue","suburb":"Rosebank","walk_in_policy":"walk_ins_welcome"}'::jsonb
        ),
        (
          'seed-electronics-tech',
          'Seed Bytewave Tech Hub',
          'standalone_shop'::business_type,
          'electronics_tech'::business_category,
          'Repairs, accessories, and device upgrades for phones, laptops, gaming, and small office tech.',
          '/images/promo/seed-ps5.png',
          'Western Cape',
          'Cape Town',
          '+27000001002',
          '+27000001002',
          'tech.seed@verifymzansi.test',
          NULL,
          ARRAY['Phone repairs', 'Laptop upgrades', 'Accessory sales']::text[],
          NULL::jsonb,
          '{"type":"standalone_shop","street_address":"44 Loop Street","suburb":"Cape Town City Centre","walk_in_policy":"walk_ins_welcome"}'::jsonb
        ),
        (
          'seed-groceries-essentials',
          'Seed Fresh Basket Grocer',
          'standalone_shop'::business_type,
          'groceries_essentials'::business_category,
          'Neighbourhood grocery shop stocking daily essentials, pantry staples, and fresh produce packs.',
          '/images/promo/seed-mall-africa.png',
          'KwaZulu-Natal',
          'Durban',
          '+27000001003',
          '+27000001003',
          'grocer.seed@verifymzansi.test',
          NULL,
          ARRAY['Fresh produce', 'Bulk pantry packs', 'Same-day collection']::text[],
          NULL::jsonb,
          '{"type":"standalone_shop","street_address":"9 Florida Road","suburb":"Morningside","walk_in_policy":"walk_ins_welcome"}'::jsonb
        ),
        (
          'seed-health-beauty',
          'Seed Radiance Wellness Lounge',
          'home_business'::business_type,
          'health_beauty'::business_category,
          'Beauty treatments, wellness consultations, and curated skincare for appointments throughout the week.',
          '/images/promo/seed-mall-menlyn.png',
          'Mpumalanga',
          'Mbombela',
          '+27000001004',
          '+27000001004',
          'wellness.seed@verifymzansi.test',
          NULL,
          ARRAY['Facials', 'Skincare advice', 'Makeup bookings']::text[],
          NULL::jsonb,
          '{"type":"home_business","service_suburb":"West Acres","appointment_required":true,"customer_pickup_allowed":false}'::jsonb
        ),
        (
          'seed-home-living',
          'Seed Warm Home Interiors',
          'standalone_shop'::business_type,
          'home_living'::business_category,
          'Furniture, decor, and practical home-living pieces for apartments, family homes, and guest spaces.',
          '/images/promo/seed-sofa.png',
          'Free State',
          'Bloemfontein',
          '+27000001005',
          '+27000001005',
          'home.seed@verifymzansi.test',
          NULL,
          ARRAY['Furniture sourcing', 'Interior decor', 'Space styling']::text[],
          NULL::jsonb,
          '{"type":"standalone_shop","street_address":"21 Nelson Mandela Drive","suburb":"Westdene","walk_in_policy":"walk_ins_welcome"}'::jsonb
        ),
        (
          'seed-food-dining',
          'Seed Township Table Kitchen',
          'market_stall'::business_type,
          'food_dining'::business_category,
          'Fresh meals, catering trays, and crowd-friendly food packs for weekday lunches and local events.',
          '/images/promo/seed-mall-gateway.png',
          'Gauteng',
          'Soweto',
          '+27000001006',
          '+27000001006',
          'food.seed@verifymzansi.test',
          NULL,
          ARRAY['Takeaway meals', 'Event catering', 'Office lunch packs']::text[],
          NULL::jsonb,
          '{"type":"market_stall","market_name":"Vilakazi Street Market","trading_days":["Friday","Saturday","Sunday"],"trading_hours":"10:00-20:00"}'::jsonb
        ),
        (
          'seed-trade-maintenance',
          'Seed Mvelase Plumbing Services',
          'mobile_service'::business_type,
          'trade_maintenance'::business_category,
          'Call-out plumbing, leak detection, geyser replacement, and preventive maintenance for homes and shops.',
          '/images/promo/seed-plumber.png',
          'Gauteng',
          'Pretoria',
          '+27000001007',
          '+27000001007',
          'trades.seed@verifymzansi.test',
          NULL,
          ARRAY['Plumbing', 'Leak detection', 'Geyser installation']::text[],
          '{"areas":["Pretoria","Centurion","Midrand"]}'::jsonb,
          '{"type":"mobile_service","travel_radius_km":45,"callout_fee_from":450,"emergency_callouts":true}'::jsonb
        ),
        (
          'seed-professional-services',
          'Seed Ledger Lane Advisory',
          'online_only'::business_type,
          'professional_services'::business_category,
          'Remote bookkeeping, payroll support, and SME admin systems for growing teams and side hustles.',
          '/images/promo/seed-mall.png',
          'Gauteng',
          'Johannesburg',
          '+27000001008',
          '+27000001008',
          'advisory.seed@verifymzansi.test',
          'https://professional-seed.verifymzansi.test',
          ARRAY['Bookkeeping', 'Payroll setup', 'SME compliance support']::text[],
          '{"areas":["South Africa"]}'::jsonb,
          '{"type":"online_only","primary_order_channel":"website","order_url":"https://professional-seed.verifymzansi.test/book","delivery_regions":["South Africa"],"support_response_time":"Within 2 business hours"}'::jsonb
        ),
        (
          'seed-education-training',
          'Seed Bright Path Tutors',
          'home_business'::business_type,
          'education_training'::business_category,
          'After-school tutoring and exam prep for primary and high-school learners in maths, science, and English.',
          '/images/promo/seed-mall-canalwalk.png',
          'Limpopo',
          'Polokwane',
          '+27000001009',
          '+27000001009',
          'education.seed@verifymzansi.test',
          NULL,
          ARRAY['Maths tutoring', 'Science tutoring', 'Exam preparation']::text[],
          NULL::jsonb,
          '{"type":"home_business","service_suburb":"Bendor","appointment_required":true,"customer_pickup_allowed":false}'::jsonb
        ),
        (
          'seed-events-entertainment',
          'Seed Shisa Event Co',
          'market_stall'::business_type,
          'events_entertainment'::business_category,
          'Community event planning, stage hosting, and vendor coordination for launches, markets, and festivals.',
          '/images/promo/seed-mall-africa.png',
          'Eastern Cape',
          'Gqeberha',
          '+27000001010',
          '+27000001010',
          'events.seed@verifymzansi.test',
          NULL,
          ARRAY['Event hosting', 'Vendor coordination', 'Launch support']::text[],
          NULL::jsonb,
          '{"type":"market_stall","market_name":"Baakens Valley Pop-Up","trading_days":["Saturday"],"trading_hours":"09:00-17:00"}'::jsonb
        ),
        (
          'seed-automotive-transport',
          'Seed DriveSure Mobility',
          'mobile_service'::business_type,
          'automotive_transport'::business_category,
          'Mobile diagnostics, shuttle bookings, and vehicle support for commuters, SMEs, and event logistics.',
          '/images/promo/seed-hilux.png',
          'North West',
          'Rustenburg',
          '+27000001011',
          '+27000001011',
          'auto.seed@verifymzansi.test',
          NULL,
          ARRAY['Vehicle diagnostics', 'Airport shuttle bookings', 'Fleet support']::text[],
          '{"areas":["Rustenburg","Sun City","Johannesburg"]}'::jsonb,
          '{"type":"mobile_service","travel_radius_km":120,"callout_fee_from":550,"emergency_callouts":false}'::jsonb
        ),
        (
          'seed-general-other',
          'Seed Mzansi Community Market',
          'standalone_shop'::business_type,
          'general_other'::business_category,
          'General retail, gift hampers, and neighbourhood notices for buyers who want a trusted local contact point.',
          '/images/promo/seed-mall-menlyn.png',
          'Northern Cape',
          'Kimberley',
          '+27000001012',
          '+27000001012',
          'general.seed@verifymzansi.test',
          NULL,
          ARRAY['Gift hampers', 'Community notices', 'General retail']::text[],
          NULL::jsonb,
          '{"type":"standalone_shop","street_address":"7 Chapel Street","suburb":"Belgravia","walk_in_policy":"walk_ins_welcome"}'::jsonb
        )
    ) AS v(
      slug,
      business_name,
      business_type,
      category,
      description,
      cover_photo,
      location_province,
      location_city,
      phone,
      whatsapp,
      email,
      website,
      services_offered,
      service_areas,
      business_details
    )
  )
  INSERT INTO public.businesses (
    seller_id,
    area,
    business_type,
    business_name,
    slug,
    description,
    category,
    cover_photo,
    location_province,
    location_city,
    phone,
    whatsapp,
    email,
    website,
    services_offered,
    service_areas,
    business_details,
    operating_hours,
    payment_methods_accepted,
    delivery_options,
    status,
    published_at
  )
  SELECT
    ss.user_id,
    'MZANSI_BUSINESS'::marketplace_area,
    b.business_type,
    b.business_name,
    b.slug,
    b.description,
    b.category,
    b.cover_photo,
    b.location_province,
    b.location_city,
    b.phone,
    b.whatsapp,
    b.email,
    b.website,
    b.services_offered,
    b.service_areas,
    b.business_details,
    '{"monday":"08:00-17:00","tuesday":"08:00-17:00","wednesday":"08:00-17:00","thursday":"08:00-17:00","friday":"08:00-17:00","saturday":"09:00-13:00","sunday":"closed"}'::jsonb,
    ARRAY['cash', 'card', 'eft']::text[],
    ARRAY['in_store', 'collection']::text[],
    'live'::listing_status,
    now()
  FROM business_seed_rows b
  CROSS JOIN seller_count sc
  JOIN seed_sellers ss
    ON ss.rn = ((b.seed_rn - 1) % sc.total) + 1
  WHERE sc.total > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.businesses existing
      WHERE existing.slug = b.slug
        AND existing.area = 'MZANSI_BUSINESS'::marketplace_area
    );

  WITH promotion_seed_rows AS (
    SELECT *
    FROM (
      VALUES
        (
          'seed-fashion-accessories',
          'fashion_accessories'::business_category,
          'Fashion & Accessories',
          '[Seed] Fashion Drop Weekend Sale',
          'Save on curated looks, handbags, and sneakers this weekend while stock lasts.',
          'deal'::promotion_type,
          ARRAY['/images/promo/promo-1.png']::text[],
          29900,
          false,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        ),
        (
          'seed-electronics-tech',
          'electronics_tech'::business_category,
          'Electronics & Tech',
          '[Seed] Laptop Tune-Up Bundle',
          'Discounted device cleanup, SSD upgrades, and accessory bundle for students and home offices.',
          'service'::promotion_type,
          ARRAY['/images/promo/promo-2.png']::text[],
          79900,
          false,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        ),
        (
          'seed-groceries-essentials',
          'groceries_essentials'::business_category,
          'Groceries & Essentials',
          '[Seed] Family Pantry Combo',
          'Bulk pantry staples and produce box combo prepared for quick weekly collection.',
          'product'::promotion_type,
          ARRAY['/images/promo/promo-3.png']::text[],
          54900,
          false,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        ),
        (
          'seed-health-beauty',
          'health_beauty'::business_category,
          'Health, Beauty & Wellness',
          '[Seed] Glow Session Booking Offer',
          'Book a skincare consultation and receive a reduced-rate treatment package this month.',
          'service'::promotion_type,
          ARRAY['/images/promo/promo-4.png']::text[],
          65000,
          false,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        ),
        (
          'seed-home-living',
          'home_living'::business_category,
          'Home & Living',
          '[Seed] Apartment Refresh Package',
          'Furniture and decor bundle pricing for compact spaces, student pads, and guest suites.',
          'deal'::promotion_type,
          ARRAY['/images/promo/promo-5.png']::text[],
          210000,
          true,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        ),
        (
          'seed-food-dining',
          'food_dining'::business_category,
          'Food & Dining',
          '[Seed] Lunch Pack Catering Special',
          'Order weekday lunch packs for your team or event and get discounted bulk pricing.',
          'deal'::promotion_type,
          ARRAY['/images/promo/promo-6.png']::text[],
          12000,
          false,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        ),
        (
          'seed-trade-maintenance',
          'trade_maintenance'::business_category,
          'Trade & Maintenance',
          '[Seed] Leak Check Call-Out Offer',
          'Reduced call-out fee for early leak detection and plumbing inspections this week.',
          'service'::promotion_type,
          ARRAY['/images/promo/seed-plumber.png']::text[],
          45000,
          false,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        ),
        (
          'seed-professional-services',
          'professional_services'::business_category,
          'Professional Services',
          '[Seed] Payroll Setup Starter Pack',
          'Flat-rate onboarding for payroll and bookkeeping workflows for small teams and freelancers.',
          'service'::promotion_type,
          ARRAY['/images/promo/seed-mall.png']::text[],
          95000,
          false,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        ),
        (
          'seed-education-training',
          'education_training'::business_category,
          'Education & Training',
          '[Seed] Exam Prep Intensive',
          'Focused tutoring package covering revision plans, worksheets, and mock exam support.',
          'service'::promotion_type,
          ARRAY['/images/promo/seed-mall-canalwalk.png']::text[],
          85000,
          false,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        ),
        (
          'seed-events-entertainment',
          'events_entertainment'::business_category,
          'Events & Entertainment',
          '[Seed] Community Market Takeover',
          'Upcoming vendor market with live hosting, family activities, and booking slots for local sellers.',
          'event'::promotion_type,
          ARRAY['/images/promo/seed-mall-africa.png']::text[],
          NULL,
          false,
          ARRAY['call', 'whatsapp']::text[],
          'upcoming'
        ),
        (
          'seed-automotive-transport',
          'automotive_transport'::business_category,
          'Automotive & Transport',
          '[Seed] Fleet Check and Shuttle Offer',
          'Weekend diagnostics plus transport support pricing for teams, groups, and event logistics.',
          'service'::promotion_type,
          ARRAY['/images/promo/seed-hilux.png']::text[],
          135000,
          false,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        ),
        (
          'seed-general-other',
          'general_other'::business_category,
          'General & Other',
          '[Seed] Local Spotlight Promo Pack',
          'General retail and neighbourhood spotlight package for brands that need quick local visibility.',
          'general'::promotion_type,
          ARRAY['/images/promo/seed-mall-menlyn.png']::text[],
          49900,
          false,
          ARRAY['call', 'whatsapp']::text[],
          NULL::text
        )
    ) AS v(
      business_slug,
      category_key,
      category_label,
      title,
      description,
      promotion_type,
      photos,
      price_cents,
      price_negotiable,
      contact_methods,
      schedule_mode
    )
  )
  INSERT INTO public.promotions (
    seller_id,
    business_id,
    title,
    description,
    promotion_type,
    category,
    category_key,
    photos,
    price_cents,
    price_negotiable,
    location_province,
    location_city,
    contact_methods,
    start_date,
    end_date,
    status,
    published_at
  )
  SELECT
    b.seller_id,
    b.id,
    p.title,
    p.description,
    p.promotion_type,
    p.category_label,
    p.category_key,
    p.photos,
    p.price_cents,
    p.price_negotiable,
    b.location_province,
    b.location_city,
    p.contact_methods,
    CASE
      WHEN p.schedule_mode = 'upcoming' THEN now() + interval '7 days'
      ELSE NULL
    END,
    CASE
      WHEN p.schedule_mode = 'upcoming' THEN now() + interval '10 days'
      ELSE NULL
    END,
    'live'::listing_status,
    now()
  FROM promotion_seed_rows p
  JOIN public.businesses b
    ON b.slug = p.business_slug
   AND b.area = 'MZANSI_BUSINESS'::marketplace_area
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.promotions existing
    WHERE existing.seller_id = b.seller_id
      AND existing.title = p.title
  );
END $$;
