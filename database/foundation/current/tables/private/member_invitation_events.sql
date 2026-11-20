-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.member_invitation_events (
  id uuid default gen_random_uuid() not null,
  email text not null,
  action text not null,
  actor_id uuid not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint member_invitation_events_action_check CHECK (action = ANY (ARRAY['invite'::text, 'renew'::text, 'revoke'::text])),
  constraint member_invitation_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint member_invitation_events_email_check CHECK (char_length(email) >= 3 AND char_length(email) <= 254),
  constraint member_invitation_events_pkey PRIMARY KEY (id)
);
alter table private.member_invitation_events owner to postgres;
alter table private.member_invitation_events enable row level security;
CREATE INDEX member_invitation_events_actor_idx ON private.member_invitation_events USING btree (actor_id, created_at);
CREATE INDEX member_invitation_events_created_at_idx ON private.member_invitation_events USING btree (created_at);
CREATE INDEX member_invitation_events_email_idx ON private.member_invitation_events USING btree (email);
CREATE TRIGGER member_invitation_events_append_only BEFORE DELETE OR UPDATE ON private.member_invitation_events FOR EACH ROW EXECUTE FUNCTION internal.append_only_guard();
CREATE TRIGGER member_invitation_events_no_truncate BEFORE TRUNCATE ON private.member_invitation_events FOR EACH STATEMENT EXECUTE FUNCTION internal.append_only_guard();
revoke all on private.member_invitation_events from public;
