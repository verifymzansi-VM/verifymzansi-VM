-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_activations (
  id uuid default gen_random_uuid() not null,
  post_id uuid,
  entitlement_id uuid not null,
  owner_id uuid not null,
  activated_at timestamp with time zone default statement_timestamp() not null,
  released_at timestamp with time zone,
  release_reason text,
  constraint post_activations_check CHECK ((released_at IS NULL) = (release_reason IS NULL)),
  constraint post_activations_check1 CHECK (post_id IS NOT NULL OR released_at IS NOT NULL),
  constraint post_activations_entitlement_id_fkey FOREIGN KEY (entitlement_id) REFERENCES private.entitlements(id) ON DELETE RESTRICT,
  constraint post_activations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint post_activations_pkey PRIMARY KEY (id),
  constraint post_activations_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE SET NULL,
  constraint post_activations_release_reason_check CHECK (release_reason = ANY (ARRAY['owner'::text, 'sold'::text, 'expired'::text, 'entitlement_ended'::text, 'payment_reversed'::text, 'moderation'::text, 'deleted'::text]))
);
alter table private.post_activations owner to postgres;
alter table private.post_activations enable row level security;
CREATE INDEX post_activations_entitlement_idx ON private.post_activations USING btree (entitlement_id, activated_at);
CREATE UNIQUE INDEX post_activations_one_active_idx ON private.post_activations USING btree (post_id) WHERE (released_at IS NULL);
CREATE TRIGGER post_activation_not_edit BEFORE INSERT OR UPDATE ON private.post_activations FOR EACH ROW EXECUTE FUNCTION internal.post_activation_edit_guard();
CREATE TRIGGER post_activation_trial_provenance AFTER INSERT ON private.post_activations FOR EACH ROW EXECUTE FUNCTION internal.track_post_trial_funding();
revoke all on private.post_activations from public;
