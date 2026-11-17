-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.account_erasure_requests (
  request_id uuid not null,
  user_id uuid not null,
  linked_how text not null,
  linked_by uuid,
  linked_at timestamp with time zone default statement_timestamp() not null,
  constraint account_erasure_requests_linked_by_fkey FOREIGN KEY (linked_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint account_erasure_requests_linked_how_check CHECK (linked_how = ANY (ARRAY['member_closed'::text, 'staff_ordered'::text])),
  constraint account_erasure_requests_pkey PRIMARY KEY (request_id),
  constraint account_erasure_requests_request_id_fkey FOREIGN KEY (request_id) REFERENCES private.privacy_requests(id) ON DELETE CASCADE,
  constraint account_erasure_requests_staff CHECK (linked_how = 'staff_ordered'::text OR linked_by IS NULL),
  constraint account_erasure_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES private.account_erasures(user_id) ON DELETE CASCADE
);
alter table private.account_erasure_requests owner to postgres;
alter table private.account_erasure_requests enable row level security;
CREATE INDEX account_erasure_requests_linked_by_idx ON private.account_erasure_requests USING btree (linked_by) WHERE (linked_by IS NOT NULL);
CREATE INDEX account_erasure_requests_user_idx ON private.account_erasure_requests USING btree (user_id);
revoke all on private.account_erasure_requests from public;
