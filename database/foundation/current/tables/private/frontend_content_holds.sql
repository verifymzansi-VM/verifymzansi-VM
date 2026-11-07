-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_content_holds (
  id uuid not null,
  post_id uuid,
  version integer default 1 not null,
  released_at timestamp with time zone,
  released_by uuid,
  release_reason text,
  restored boolean default false not null,
  account_id uuid not null,
  actor_id uuid,
  reporter_id uuid,
  reason text not null,
  applied_at timestamp with time zone not null,
  constraint frontend_content_holds_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint frontend_content_holds_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_content_holds_check CHECK ((released_at IS NULL) = (release_reason IS NULL)),
  constraint frontend_content_holds_pkey PRIMARY KEY (id),
  constraint frontend_content_holds_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE SET NULL,
  constraint frontend_content_holds_reason_check CHECK (length(reason) >= 10 AND length(reason) <= 500),
  constraint frontend_content_holds_release_reason_check CHECK (release_reason IS NULL OR length(release_reason) >= 5 AND length(release_reason) <= 500),
  constraint frontend_content_holds_released_by_fkey FOREIGN KEY (released_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_content_holds_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_content_holds_version_check CHECK (version > 0)
);
alter table private.frontend_content_holds owner to postgres;
alter table private.frontend_content_holds enable row level security;
CREATE INDEX frontend_content_holds_account_idx ON private.frontend_content_holds USING btree (account_id, applied_at);
CREATE INDEX frontend_content_holds_actor_idx ON private.frontend_content_holds USING btree (actor_id);
CREATE INDEX frontend_content_holds_post_idx ON private.frontend_content_holds USING btree (post_id) WHERE (released_at IS NULL);
CREATE INDEX frontend_content_holds_post_reference_idx ON private.frontend_content_holds USING btree (post_id) WHERE (post_id IS NOT NULL);
CREATE INDEX frontend_content_holds_releaser_idx ON private.frontend_content_holds USING btree (released_by);
CREATE INDEX frontend_content_holds_reporter_idx ON private.frontend_content_holds USING btree (reporter_id);
CREATE TRIGGER publish_frontend_hidden_notice AFTER INSERT ON private.frontend_content_holds FOR EACH ROW EXECUTE FUNCTION internal.publish_frontend_moderation_notice();
revoke all on private.frontend_content_holds from public;
