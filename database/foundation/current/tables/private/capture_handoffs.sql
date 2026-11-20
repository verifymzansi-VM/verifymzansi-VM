-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.capture_handoffs (
  token_sha256 text not null,
  owner_id uuid not null,
  case_id uuid not null,
  session_id uuid not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  grant_sha256 text,
  fingerprint text,
  encrypted_number jsonb,
  constraint capture_handoffs_case_id_owner_id_fkey FOREIGN KEY (case_id, owner_id) REFERENCES private.evidence_cases(id, subject_id) ON DELETE CASCADE,
  constraint capture_handoffs_encrypted_number_check CHECK (encrypted_number IS NULL OR jsonb_typeof(encrypted_number) = 'object'::text AND (encrypted_number - ARRAY['ciphertext'::text, 'iv'::text, 'tag'::text, 'key_id'::text]) = '{}'::jsonb AND encrypted_number ?& ARRAY['ciphertext'::text, 'iv'::text, 'tag'::text, 'key_id'::text] AND (encrypted_number ->> 'ciphertext'::text) ~ '^[a-f0-9]{26}$'::text AND (encrypted_number ->> 'iv'::text) ~ '^[a-f0-9]{24}$'::text AND (encrypted_number ->> 'tag'::text) ~ '^[a-f0-9]{32}$'::text AND (encrypted_number ->> 'key_id'::text) = 'identity-number-v1'::text),
  constraint capture_handoffs_expiry_check CHECK (expires_at = (created_at + '00:15:00'::interval)),
  constraint capture_handoffs_fingerprint_check CHECK (fingerprint ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text),
  constraint capture_handoffs_grant_check CHECK (grant_sha256 ~ '^[a-f0-9]{64}$'::text AND grant_sha256 <> token_sha256),
  constraint capture_handoffs_grant_key UNIQUE (grant_sha256),
  constraint capture_handoffs_identity_check CHECK ((fingerprint IS NULL) = (encrypted_number IS NULL)),
  constraint capture_handoffs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint capture_handoffs_pkey PRIMARY KEY (token_sha256),
  constraint capture_handoffs_token_check CHECK (token_sha256 ~ '^[a-f0-9]{64}$'::text),
  constraint capture_handoffs_used_check CHECK (grant_sha256 IS NULL OR used_at IS NOT NULL)
);
alter table private.capture_handoffs owner to postgres;
alter table private.capture_handoffs enable row level security;
CREATE INDEX capture_handoffs_case_idx ON private.capture_handoffs USING btree (case_id, owner_id);
CREATE INDEX capture_handoffs_expires_idx ON private.capture_handoffs USING btree (expires_at);
CREATE INDEX capture_handoffs_owner_idx ON private.capture_handoffs USING btree (owner_id, created_at DESC);
revoke all on private.capture_handoffs from public;
comment on table private.capture_handoffs is 'Continue on your phone links: SHA-256 of a single-use token, bound to one account, its open identity case and the computer''s live session, valid 15 minutes; the phone''s capture grant is stored as a SHA-256 only. Deleted one day after expiry.';
