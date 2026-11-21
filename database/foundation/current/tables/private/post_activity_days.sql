-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_activity_days (
  post_id uuid not null,
  day date not null,
  list_impressions integer default 0 not null,
  search_appearances integer default 0 not null,
  homepage_appearances integer default 0 not null,
  showroom_home integer default 0 not null,
  showroom_business integer default 0 not null,
  showroom_market integer default 0 not null,
  showroom_tourism integer default 0 not null,
  showroom_programme integer default 0 not null,
  directory_appearances integer default 0 not null,
  views_direct integer default 0 not null,
  views_internal integer default 0 not null,
  views_search integer default 0 not null,
  views_social integer default 0 not null,
  views_referral integer default 0 not null,
  whatsapp_taps integer default 0 not null,
  phone_taps integer default 0 not null,
  website_taps integer default 0 not null,
  directions_taps integer default 0 not null,
  booking_taps integer default 0 not null,
  ticket_taps integer default 0 not null,
  shares integer default 0 not null,
  constraint post_activity_days_counts_check CHECK (LEAST(list_impressions, search_appearances, homepage_appearances, showroom_home, showroom_business, showroom_market, showroom_tourism, showroom_programme, directory_appearances, views_direct, views_internal, views_search, views_social, views_referral, whatsapp_taps, phone_taps, website_taps, directions_taps, booking_taps, ticket_taps, shares) >= 0),
  constraint post_activity_days_pkey PRIMARY KEY (post_id, day),
  constraint post_activity_days_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE
);
alter table private.post_activity_days owner to postgres;
alter table private.post_activity_days enable row level security;
CREATE INDEX post_activity_days_day_idx ON private.post_activity_days USING btree (day);
revoke all on private.post_activity_days from public;
