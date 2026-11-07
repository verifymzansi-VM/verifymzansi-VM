-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.enquiries (
  id uuid default gen_random_uuid() not null,
  request_id uuid not null,
  post_id uuid not null,
  owner_id uuid not null,
  sender_account_id uuid,
  buyer_name text,
  buyer_email text not null,
  email_confirmed boolean not null,
  buyer_phone text,
  message text not null,
  status text default 'new'::text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  updated_at timestamp with time zone default statement_timestamp() not null,
  retain_until timestamp with time zone not null,
  constraint enquiries_buyer_email_check CHECK (internal.enquiry_email_valid(buyer_email)),
  constraint enquiries_buyer_name_check CHECK (buyer_name IS NULL OR internal.plain_text_valid(buyer_name, 2, 80, false)),
  constraint enquiries_buyer_phone_check CHECK (buyer_phone IS NULL OR buyer_phone ~ '^[+]27[0-9]{9}$'::text),
  constraint enquiries_check CHECK (retain_until = (created_at + '1 year'::interval)),
  constraint enquiries_check1 CHECK (sender_account_id IS DISTINCT FROM owner_id),
  constraint enquiries_message_check CHECK (internal.plain_text_valid(message, 10, 1000, true)),
  constraint enquiries_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint enquiries_pkey PRIMARY KEY (id),
  constraint enquiries_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint enquiries_request_id_key UNIQUE (request_id),
  constraint enquiries_sender_account_id_fkey FOREIGN KEY (sender_account_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint enquiries_status_check CHECK (status = ANY (ARRAY['new'::text, 'read'::text, 'contacted'::text, 'closed'::text]))
);
alter table private.enquiries owner to postgres;
alter table private.enquiries enable row level security;
CREATE INDEX enquiries_email_flood_idx ON private.enquiries USING btree (buyer_email, created_at);
CREATE INDEX enquiries_owner_inbox_idx ON private.enquiries USING btree (owner_id, created_at DESC, id DESC);
CREATE INDEX enquiries_owner_new_idx ON private.enquiries USING btree (owner_id) WHERE (status = 'new'::text);
CREATE INDEX enquiries_post_flood_idx ON private.enquiries USING btree (post_id, created_at);
CREATE INDEX enquiries_retention_idx ON private.enquiries USING btree (retain_until);
CREATE INDEX enquiries_sender_idx ON private.enquiries USING btree (sender_account_id) WHERE (sender_account_id IS NOT NULL);
CREATE TRIGGER enquiry_guard BEFORE UPDATE ON private.enquiries FOR EACH ROW EXECUTE FUNCTION internal.enquiry_guard();
revoke all on private.enquiries from public;
