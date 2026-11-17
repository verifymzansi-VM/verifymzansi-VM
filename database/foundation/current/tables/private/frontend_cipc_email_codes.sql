-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_cipc_email_codes (
  check_id uuid not null,
  challenge uuid default gen_random_uuid() not null,
  digest text not null,
  expires_at timestamp with time zone not null,
  started_at timestamp with time zone not null,
  sent_at timestamp with time zone,
  attempts integer default 0 not null,
  constraint frontend_cipc_email_codes_attempts_check CHECK (attempts >= 0 AND attempts <= 5),
  constraint frontend_cipc_email_codes_challenge_key UNIQUE (challenge),
  constraint frontend_cipc_email_codes_check CHECK (expires_at > started_at),
  constraint frontend_cipc_email_codes_check_id_fkey FOREIGN KEY (check_id) REFERENCES private.frontend_cipc_reviews(check_id) ON DELETE CASCADE,
  constraint frontend_cipc_email_codes_digest_check CHECK (digest ~ '^[0-9a-f]{64}$'::text),
  constraint frontend_cipc_email_codes_pkey PRIMARY KEY (check_id)
);
alter table private.frontend_cipc_email_codes owner to postgres;
alter table private.frontend_cipc_email_codes enable row level security;
revoke all on private.frontend_cipc_email_codes from public;
