-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_account_restrictions (
  id uuid default gen_random_uuid() not null,
  decision_id uuid not null,
  account_id uuid not null,
  reporter_id uuid,
  kind text not null,
  reason text not null,
  emergency boolean not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone,
  version integer default 1 not null,
  lifted_at timestamp with time zone,
  lifted_by uuid,
  lift_reason text,
  constraint frontend_account_restrictions_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint frontend_account_restrictions_check CHECK ((kind = 'ban'::text) = (ends_at IS NULL)),
  constraint frontend_account_restrictions_check1 CHECK (ends_at IS NULL OR ends_at > starts_at),
  constraint frontend_account_restrictions_check2 CHECK (NOT emergency OR kind = 'suspension'::text),
  constraint frontend_account_restrictions_check3 CHECK ((lifted_at IS NULL) = (lift_reason IS NULL)),
  constraint frontend_account_restrictions_decision_id_emergency_key UNIQUE (decision_id, emergency),
  constraint frontend_account_restrictions_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES private.decisions(id) ON DELETE CASCADE,
  constraint frontend_account_restrictions_kind_check CHECK (kind = ANY (ARRAY['suspension'::text, 'ban'::text])),
  constraint frontend_account_restrictions_lift_reason_check CHECK (lift_reason IS NULL OR length(lift_reason) >= 5 AND length(lift_reason) <= 500),
  constraint frontend_account_restrictions_lifted_by_fkey FOREIGN KEY (lifted_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_account_restrictions_pkey PRIMARY KEY (id),
  constraint frontend_account_restrictions_reason_check CHECK (length(reason) >= 10 AND length(reason) <= 500),
  constraint frontend_account_restrictions_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_account_restrictions_version_check CHECK (version > 0)
);
alter table private.frontend_account_restrictions owner to postgres;
alter table private.frontend_account_restrictions enable row level security;
CREATE INDEX frontend_account_restrictions_account_id_idx ON private.frontend_account_restrictions USING btree (account_id);
CREATE INDEX frontend_account_restrictions_releaser_idx ON private.frontend_account_restrictions USING btree (lifted_by);
CREATE INDEX frontend_account_restrictions_reporter_idx ON private.frontend_account_restrictions USING btree (reporter_id);
CREATE INDEX frontend_account_restrictions_subject_idx ON private.frontend_account_restrictions USING btree (account_id, ends_at) WHERE (lifted_at IS NULL);
CREATE TRIGGER publish_frontend_restriction_notice AFTER INSERT ON private.frontend_account_restrictions FOR EACH ROW EXECUTE FUNCTION internal.publish_frontend_moderation_notice();
revoke all on private.frontend_account_restrictions from public;
