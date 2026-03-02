-- Add categories to Mall Shops (storefronts) and Business Ads (business_profiles)

CREATE TYPE mall_shop_category AS ENUM (
  'mall_fashion',
  'mall_electronics',
  'mall_groceries',
  'mall_health_beauty',
  'mall_home_decor',
  'mall_sports_hobbies',
  'mall_dining',
  'mall_services'
);

CREATE TYPE business_ad_category AS ENUM (
  'biz_events',
  'biz_government',
  'biz_home_trades',
  'biz_professional',
  'biz_education',
  'biz_automotive',
  'biz_health',
  'biz_general'
);

ALTER TABLE storefronts ADD COLUMN category mall_shop_category NOT NULL DEFAULT 'mall_services';
ALTER TABLE business_profiles ADD COLUMN category business_ad_category NOT NULL DEFAULT 'biz_general';
