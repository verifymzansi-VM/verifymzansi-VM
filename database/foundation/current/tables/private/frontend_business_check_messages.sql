-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_business_check_messages (
  id uuid default gen_random_uuid() not null,
  check_id uuid not null,
  author_id uuid,
  author_role text not null,
  body text not null,
  attachment_file_id uuid,
  created_at timestamp with time zone default clock_timestamp() not null,
  constraint frontend_business_check_messages_attachment_file_id_fkey FOREIGN KEY (attachment_file_id) REFERENCES private.evidence_artifacts(id) ON DELETE SET NULL,
  constraint frontend_business_check_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_business_check_messages_author_role_check CHECK (author_role = ANY (ARRAY['owner'::text, 'staff'::text])),
  constraint frontend_business_check_messages_body_check CHECK (length(body) >= 1 AND length(body) <= 2000),
  constraint frontend_business_check_messages_check_id_fkey FOREIGN KEY (check_id) REFERENCES private.frontend_business_checks(id) ON DELETE CASCADE,
  constraint frontend_business_check_messages_pkey PRIMARY KEY (id)
);
alter table private.frontend_business_check_messages owner to postgres;
alter table private.frontend_business_check_messages enable row level security;
CREATE UNIQUE INDEX frontend_business_messages_attachment_idx ON private.frontend_business_check_messages USING btree (attachment_file_id) WHERE (attachment_file_id IS NOT NULL);
CREATE INDEX frontend_business_messages_author_idx ON private.frontend_business_check_messages USING btree (author_id);
CREATE INDEX frontend_business_messages_case_idx ON private.frontend_business_check_messages USING btree (check_id, created_at, id);
CREATE TRIGGER notify_frontend_business_message AFTER INSERT ON private.frontend_business_check_messages FOR EACH ROW EXECUTE FUNCTION internal.notify_frontend_business_check();
revoke all on private.frontend_business_check_messages from public;
