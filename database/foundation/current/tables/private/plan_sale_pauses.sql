-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.plan_sale_pauses (
  plan_version_id uuid not null,
  retired_at timestamp with time zone not null,
  reason text not null,
  constraint plan_sale_pauses_pkey PRIMARY KEY (plan_version_id),
  constraint plan_sale_pauses_plan_version_id_fkey FOREIGN KEY (plan_version_id) REFERENCES private.plan_versions(id) ON DELETE RESTRICT,
  constraint plan_sale_pauses_reason_check CHECK (reason = 'posting_terms_v4_switch'::text)
);
alter table private.plan_sale_pauses owner to postgres;
alter table private.plan_sale_pauses enable row level security;
revoke all on private.plan_sale_pauses from public;
