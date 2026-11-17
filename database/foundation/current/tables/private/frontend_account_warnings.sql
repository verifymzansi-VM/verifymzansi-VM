-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_account_warnings (
  receipt_id uuid not null,
  account_id uuid not null,
  constraint frontend_account_warnings_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint frontend_account_warnings_pkey PRIMARY KEY (receipt_id),
  constraint frontend_account_warnings_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES private.frontend_report_action_receipts(id) ON DELETE CASCADE
);
alter table private.frontend_account_warnings owner to postgres;
alter table private.frontend_account_warnings enable row level security;
CREATE INDEX frontend_account_warnings_account_idx ON private.frontend_account_warnings USING btree (account_id);
revoke all on private.frontend_account_warnings from public;
