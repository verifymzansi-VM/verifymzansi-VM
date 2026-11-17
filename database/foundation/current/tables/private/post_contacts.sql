-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_contacts (
  post_id uuid not null,
  post_kind text not null,
  channels text[] not null,
  constraint post_contacts_channels_check CHECK (channels = internal.canonical_post_channels(to_jsonb(channels))),
  constraint post_contacts_pkey PRIMARY KEY (post_id),
  constraint post_contacts_post_id_post_kind_fkey FOREIGN KEY (post_id, post_kind) REFERENCES private.posts(id, kind) ON DELETE CASCADE,
  constraint post_contacts_post_kind_check CHECK (post_kind = ANY (ARRAY['listing'::text, 'event'::text]))
);
alter table private.post_contacts owner to postgres;
alter table private.post_contacts enable row level security;
CREATE TRIGGER post_contacts_edit_frozen BEFORE INSERT OR DELETE OR UPDATE ON private.post_contacts FOR EACH ROW EXECUTE FUNCTION internal.post_edit_guard();
CREATE TRIGGER post_contacts_no_truncate BEFORE TRUNCATE ON private.post_contacts FOR EACH STATEMENT EXECUTE FUNCTION internal.core_no_detail_truncate();
revoke all on private.post_contacts from public;
