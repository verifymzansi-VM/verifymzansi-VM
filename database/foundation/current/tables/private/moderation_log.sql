-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.moderation_log (
  id bigint generated always as identity not null,
  post_id uuid not null,
  edit_id uuid,
  staff_id uuid not null,
  decision text not null,
  post_revision integer not null,
  reason text,
  decided_at timestamp with time zone default statement_timestamp() not null,
  price_only boolean default false not null,
  constraint moderation_log_check CHECK (edit_id IS DISTINCT FROM post_id),
  constraint moderation_log_check1 CHECK (NOT price_only OR edit_id IS NOT NULL),
  constraint moderation_log_decision_check CHECK (decision = ANY (ARRAY['approve'::text, 'reject'::text])),
  constraint moderation_log_pkey PRIMARY KEY (id),
  constraint moderation_log_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES auth.users(id) ON DELETE RESTRICT
);
alter table private.moderation_log owner to postgres;
alter table private.moderation_log enable row level security;
CREATE INDEX moderation_log_approved_edits_idx ON private.moderation_log USING btree (post_id) WHERE ((edit_id IS NOT NULL) AND (decision = 'approve'::text));
CREATE INDEX moderation_log_audit_time_idx ON private.moderation_log USING btree (decided_at DESC, id DESC);
CREATE TRIGGER capture_frontend_post_approval AFTER INSERT ON private.moderation_log FOR EACH ROW EXECUTE FUNCTION internal.capture_frontend_post_approval();
CREATE TRIGGER guard_frontend_offline_review_budget BEFORE INSERT ON private.moderation_log FOR EACH ROW EXECUTE FUNCTION internal.guard_frontend_offline_review_budget();
CREATE TRIGGER moderation_log_append_only BEFORE DELETE OR UPDATE ON private.moderation_log FOR EACH ROW EXECUTE FUNCTION internal.append_only_guard();
CREATE TRIGGER moderation_log_no_truncate BEFORE TRUNCATE ON private.moderation_log FOR EACH STATEMENT EXECUTE FUNCTION internal.append_only_guard();
revoke all on private.moderation_log from public;
