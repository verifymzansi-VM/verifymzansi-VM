-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.payment_problem_digests (
  day date not null,
  claim uuid,
  claimed_until timestamp with time zone,
  window_end timestamp with time zone,
  content jsonb,
  done_at timestamp with time zone,
  constraint payment_problem_digests_claim_key UNIQUE (claim),
  constraint payment_problem_digests_content_check CHECK (jsonb_typeof(content) = 'object'::text),
  constraint payment_problem_digests_pkey PRIMARY KEY (day)
);
alter table private.payment_problem_digests owner to postgres;
alter table private.payment_problem_digests enable row level security;
revoke all on private.payment_problem_digests from public;
