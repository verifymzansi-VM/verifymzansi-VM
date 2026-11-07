-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_form_drafts (
  owner_id uuid not null,
  flow text not null,
  step integer not null,
  data jsonb not null,
  saved_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  constraint frontend_form_drafts_check CHECK (expires_at > saved_at),
  constraint frontend_form_drafts_data_check CHECK (jsonb_typeof(data) = 'object'::text AND octet_length(data::text) <= 65536),
  constraint frontend_form_drafts_flow_check CHECK (flow = ANY (ARRAY['listing'::text, 'business'::text, 'promotion'::text])),
  constraint frontend_form_drafts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint frontend_form_drafts_pkey PRIMARY KEY (owner_id, flow),
  constraint frontend_form_drafts_step_check CHECK (step >= 0)
);
alter table private.frontend_form_drafts owner to postgres;
alter table private.frontend_form_drafts enable row level security;
CREATE INDEX frontend_form_drafts_expiry_idx ON private.frontend_form_drafts USING btree (expires_at, owner_id, flow);
revoke all on private.frontend_form_drafts from public;
