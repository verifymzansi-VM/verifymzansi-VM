-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_appeals (
  id uuid default gen_random_uuid() not null,
  action_id uuid not null,
  appellant_id uuid not null,
  kind text not null,
  reason text not null,
  status text default 'submitted'::text not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  reviewer_id uuid,
  reviewer_rationale text,
  resolved_at timestamp with time zone,
  shorten_to timestamp with time zone,
  resolution_effect_version integer,
  effects_changed integer default 0 not null,
  constraint frontend_appeals_action_id_key UNIQUE (action_id),
  constraint frontend_appeals_appellant_id_fkey FOREIGN KEY (appellant_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint frontend_appeals_check CHECK ((status = 'submitted'::text) = (resolved_at IS NULL)),
  constraint frontend_appeals_check1 CHECK ((resolved_at IS NULL) = (reviewer_rationale IS NULL)),
  constraint frontend_appeals_check2 CHECK ((status = 'partially_overturned'::text) = (shorten_to IS NOT NULL)),
  constraint frontend_appeals_effects_changed_check CHECK (effects_changed >= 0 AND effects_changed <= 1),
  constraint frontend_appeals_kind_check CHECK (kind = ANY (ARRAY['suspension'::text, 'ban'::text, 'warning'::text, 'content_hidden'::text])),
  constraint frontend_appeals_pkey PRIMARY KEY (id),
  constraint frontend_appeals_reason_check CHECK (length(reason) >= 20 AND length(reason) <= 2000),
  constraint frontend_appeals_resolution_effect_version_check CHECK (resolution_effect_version > 0),
  constraint frontend_appeals_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_appeals_reviewer_rationale_check CHECK (length(reviewer_rationale) >= 10 AND length(reviewer_rationale) <= 2000),
  constraint frontend_appeals_status_check CHECK (status = ANY (ARRAY['submitted'::text, 'upheld'::text, 'overturned'::text, 'partially_overturned'::text, 'dismissed'::text]))
);
alter table private.frontend_appeals owner to postgres;
alter table private.frontend_appeals enable row level security;
CREATE INDEX frontend_appeals_appellant_idx ON private.frontend_appeals USING btree (appellant_id, created_at);
CREATE INDEX frontend_appeals_pending_idx ON private.frontend_appeals USING btree (created_at, id) WHERE (status = 'submitted'::text);
CREATE INDEX frontend_appeals_reviewer_idx ON private.frontend_appeals USING btree (reviewer_id);
CREATE TRIGGER publish_frontend_appeal_notice AFTER UPDATE OF status ON private.frontend_appeals FOR EACH ROW WHEN (old.status = 'submitted'::text AND new.status <> 'submitted'::text) EXECUTE FUNCTION internal.publish_frontend_moderation_notice();
revoke all on private.frontend_appeals from public;
