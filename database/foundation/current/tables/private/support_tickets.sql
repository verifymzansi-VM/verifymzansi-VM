-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.support_tickets (
  id uuid default gen_random_uuid() not null,
  name text not null,
  email text not null,
  category text not null,
  message text not null,
  status text default 'new'::text not null,
  revision integer default 1 not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  constraint support_tickets_category_check CHECK (category = ANY (ARRAY['fraud_report'::text, 'verification_appeal'::text, 'privacy_popia'::text, 'payment_refund'::text, 'security_vulnerability'::text, 'business_claim'::text, 'organisation_proposal'::text, 'general_support'::text])),
  constraint support_tickets_email_check CHECK (length(email) >= 3 AND length(email) <= 254),
  constraint support_tickets_message_check CHECK (length(message) >= 10 AND length(message) <= 2000),
  constraint support_tickets_name_check CHECK (length(name) >= 2 AND length(name) <= 100),
  constraint support_tickets_pkey PRIMARY KEY (id),
  constraint support_tickets_revision_check CHECK (revision > 0),
  constraint support_tickets_status_check CHECK (status = ANY (ARRAY['new'::text, 'in_progress'::text, 'resolved'::text]))
);
alter table private.support_tickets owner to postgres;
alter table private.support_tickets enable row level security;
CREATE INDEX support_tickets_open_idx ON private.support_tickets USING btree (created_at, id) WHERE (status = 'new'::text);
CREATE INDEX support_tickets_queue_idx ON private.support_tickets USING btree (created_at DESC, id DESC);
CREATE INDEX support_tickets_sender_idx ON private.support_tickets USING btree (email, created_at DESC);
revoke all on private.support_tickets from public;
