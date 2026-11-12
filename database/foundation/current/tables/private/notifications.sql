-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.notifications (
  id uuid default gen_random_uuid() not null,
  account_id uuid not null,
  kind text not null,
  subject_id uuid not null,
  post_id uuid,
  created_at timestamp with time zone default statement_timestamp() not null,
  read_at timestamp with time zone,
  organisation_id uuid,
  constraint notifications_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint notifications_check CHECK (read_at IS NULL OR read_at >= created_at),
  constraint notifications_kind_check CHECK (kind = ANY (ARRAY['enquiry_received'::text, 'organisation_application_received'::text, 'organisation_application_decided'::text, 'organisation_affiliation_ended'::text, 'organisation_sponsorship_activated'::text, 'organisation_sponsorship_ended'::text, 'partner_commission_approved'::text, 'partner_commission_reversed'::text, 'account_warning'::text, 'content_hidden'::text, 'account_suspended'::text, 'account_banned'::text, 'appeal_decided'::text, 'business_check_update'::text, 'verification_returned'::text])),
  constraint notifications_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE CASCADE,
  constraint notifications_pkey PRIMARY KEY (id),
  constraint notifications_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE
);
alter table private.notifications owner to postgres;
alter table private.notifications enable row level security;
CREATE INDEX notifications_account_idx ON private.notifications USING btree (account_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX notifications_enquiry_once_idx ON private.notifications USING btree (subject_id) WHERE (kind = 'enquiry_received'::text);
CREATE INDEX notifications_organisation_idx ON private.notifications USING btree (organisation_id) WHERE (organisation_id IS NOT NULL);
CREATE INDEX notifications_post_idx ON private.notifications USING btree (post_id) WHERE (post_id IS NOT NULL);
CREATE INDEX notifications_retention_idx ON private.notifications USING btree (created_at);
CREATE INDEX notifications_unread_idx ON private.notifications USING btree (account_id) WHERE (read_at IS NULL);
CREATE TRIGGER notification_guard BEFORE UPDATE ON private.notifications FOR EACH ROW EXECUTE FUNCTION internal.notification_guard();
revoke all on private.notifications from public;
