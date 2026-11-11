-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.entitlements (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  source text not null,
  area text,
  payment_id uuid,
  sponsorship_id uuid,
  contract_id uuid,
  granted_by uuid,
  slot_capacity integer not null,
  activations_per_period integer,
  activation_period_days integer default 30 not null,
  max_photos integer not null,
  max_videos integer not null,
  starts_at timestamp with time zone not null,
  addon_capabilities text[] default '{}'::text[] not null,
  ends_at timestamp with time zone not null,
  status text default 'active'::text not null,
  revoked_reason text,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint entitlements_activation_period_days_check CHECK (activation_period_days >= 1 AND activation_period_days <= 366),
  constraint entitlements_activations_per_period_check CHECK (activations_per_period >= 1 AND activations_per_period <= 10000),
  constraint entitlements_addon_capabilities_check CHECK (
CASE
    WHEN COALESCE(array_ndims(addon_capabilities), 1) <> 1 THEN false
    ELSE addon_capabilities <@ ARRAY['boost'::text, 'featured'::text, 'urgent'::text] AND array_position(addon_capabilities, NULL::text) IS NULL AND cardinality(addon_capabilities) = (('boost'::text = ANY (addon_capabilities))::integer + ('featured'::text = ANY (addon_capabilities))::integer + ('urgent'::text = ANY (addon_capabilities))::integer)
END),
  constraint entitlements_area_check CHECK (area = ANY (ARRAY['market'::text, 'business'::text, 'tourism_events'::text])),
  constraint entitlements_check CHECK (ends_at > starts_at),
  constraint entitlements_check1 CHECK ((source = 'retail_paid'::text) = (payment_id IS NOT NULL)),
  constraint entitlements_check2 CHECK (source <> 'sponsorship'::text OR sponsorship_id IS NOT NULL),
  constraint entitlements_check3 CHECK (source <> 'contract'::text OR contract_id IS NOT NULL),
  constraint entitlements_check4 CHECK (source <> 'staff_grant'::text OR granted_by IS NOT NULL),
  constraint entitlements_check5 CHECK ((status = 'revoked'::text) = (revoked_reason IS NOT NULL)),
  constraint entitlements_check6 CHECK (source <> 'intro_trial'::text OR addon_capabilities = '{}'::text[]),
  constraint entitlements_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint entitlements_max_photos_check CHECK (max_photos >= 1 AND max_photos <= 50),
  constraint entitlements_max_videos_check CHECK (max_videos >= 0 AND max_videos <= 10),
  constraint entitlements_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint entitlements_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE RESTRICT,
  constraint entitlements_payment_id_key UNIQUE (payment_id),
  constraint entitlements_pkey PRIMARY KEY (id),
  constraint entitlements_slot_capacity_check CHECK (slot_capacity >= 1 AND slot_capacity <= 1000),
  constraint entitlements_source_check CHECK (source = ANY (ARRAY['retail_paid'::text, 'intro_trial'::text, 'sponsorship'::text, 'contract'::text, 'staff_grant'::text])),
  constraint entitlements_status_check CHECK (status = ANY (ARRAY['active'::text, 'pending_verification'::text, 'revoked'::text]))
);
alter table private.entitlements owner to postgres;
alter table private.entitlements enable row level security;
CREATE INDEX entitlements_granted_by_idx ON private.entitlements USING btree (granted_by) WHERE (granted_by IS NOT NULL);
CREATE INDEX entitlements_owner_usable_idx ON private.entitlements USING btree (owner_id, ends_at) WHERE (status = 'active'::text);
CREATE TRIGGER entitlement_capabilities_immutable BEFORE UPDATE OF addon_capabilities ON private.entitlements FOR EACH ROW EXECUTE FUNCTION internal.entitlement_capability_guard();
revoke all on private.entitlements from public;
