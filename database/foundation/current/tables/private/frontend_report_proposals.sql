-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_report_proposals (
  decision_id uuid not null,
  receipt_id uuid not null,
  report_revision integer not null,
  expires_at timestamp with time zone not null,
  constraint frontend_report_proposals_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES private.decisions(id) ON DELETE CASCADE,
  constraint frontend_report_proposals_pkey PRIMARY KEY (decision_id),
  constraint frontend_report_proposals_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES private.frontend_report_action_receipts(id) ON DELETE CASCADE,
  constraint frontend_report_proposals_receipt_id_key UNIQUE (receipt_id),
  constraint frontend_report_proposals_report_revision_check CHECK (report_revision > 0)
);
alter table private.frontend_report_proposals owner to postgres;
alter table private.frontend_report_proposals enable row level security;
revoke all on private.frontend_report_proposals from public;
