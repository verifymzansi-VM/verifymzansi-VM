-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.identity_ban_proposal_requests (
  id uuid not null,
  owner_id uuid not null,
  fact_id uuid not null,
  category text not null,
  decision_id uuid not null,
  constraint identity_ban_proposal_requests_category_check CHECK (category = ANY (ARRAY['fraud'::text, 'fake_listings'::text, 'harassment'::text, 'impersonation'::text, 'repeat_abuse'::text, 'other'::text])),
  constraint identity_ban_proposal_requests_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES private.decisions(id),
  constraint identity_ban_proposal_requests_decision_id_key UNIQUE (decision_id),
  constraint identity_ban_proposal_requests_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id),
  constraint identity_ban_proposal_requests_pkey PRIMARY KEY (id)
);
alter table private.identity_ban_proposal_requests owner to postgres;
alter table private.identity_ban_proposal_requests enable row level security;
revoke all on private.identity_ban_proposal_requests from public;
