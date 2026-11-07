-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.account_closures (
  user_id uuid not null,
  closed_at timestamp with time zone default statement_timestamp() not null,
  evidence_delete_after timestamp with time zone not null,
  constraint account_closures_check CHECK (evidence_delete_after = (closed_at + '90 days'::interval)),
  constraint account_closures_pkey PRIMARY KEY (user_id),
  constraint account_closures_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT
);
alter table private.account_closures owner to postgres;
alter table private.account_closures enable row level security;
CREATE TRIGGER frontend_form_drafts_account_closed AFTER INSERT ON private.account_closures FOR EACH ROW EXECUTE FUNCTION internal.clear_closed_account_form_drafts();
CREATE TRIGGER verification_closure_invalidation AFTER INSERT ON private.account_closures FOR EACH ROW EXECUTE FUNCTION internal.verification_closure_invalidation();
revoke all on private.account_closures from public;
