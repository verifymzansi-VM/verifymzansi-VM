-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.lost_email_alerts (
  id uuid not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  claimed_until timestamp with time zone not null,
  items jsonb not null,
  total integer not null,
  sent_at timestamp with time zone,
  payments integer,
  constraint lost_email_alerts_items_check CHECK (jsonb_typeof(items) = 'array'::text),
  constraint lost_email_alerts_payments_check CHECK (payments >= 0 AND payments <= total),
  constraint lost_email_alerts_pkey PRIMARY KEY (id),
  constraint lost_email_alerts_total_check CHECK (total > 0)
);
alter table private.lost_email_alerts owner to postgres;
alter table private.lost_email_alerts enable row level security;
CREATE INDEX lost_email_alerts_unsent_idx ON private.lost_email_alerts USING btree (created_at, id) WHERE (sent_at IS NULL);
revoke all on private.lost_email_alerts from public;
