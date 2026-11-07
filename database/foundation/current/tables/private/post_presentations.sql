-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_presentations (
  post_id uuid not null,
  data jsonb not null,
  contacts jsonb default '{}'::jsonb not null,
  constraint post_presentations_contacts_check CHECK (jsonb_typeof(contacts) = 'object'::text AND octet_length(contacts::text) <= 1024),
  constraint post_presentations_data_check CHECK (jsonb_typeof(data) = 'object'::text AND octet_length(data::text) <= 65536),
  constraint post_presentations_pkey PRIMARY KEY (post_id),
  constraint post_presentations_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE
);
alter table private.post_presentations owner to postgres;
alter table private.post_presentations enable row level security;
revoke all on private.post_presentations from public;
