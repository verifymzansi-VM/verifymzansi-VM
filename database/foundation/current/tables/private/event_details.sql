-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.event_details (
  post_id uuid not null,
  post_kind text default 'event'::text not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  timezone text not null,
  constraint core_event_detail TRIGGER DEFERRABLE INITIALLY DEFERRED,
  constraint event_details_check CHECK (starts_at = date_trunc('milliseconds'::text, starts_at) AND ends_at = date_trunc('milliseconds'::text, ends_at)),
  constraint event_details_check1 CHECK (ends_at > starts_at AND (ends_at - starts_at) <= '90 days'::interval),
  constraint event_details_pkey PRIMARY KEY (post_id),
  constraint event_details_post_id_post_kind_fkey FOREIGN KEY (post_id, post_kind) REFERENCES private.posts(id, kind) ON DELETE CASCADE,
  constraint event_details_post_kind_check CHECK (post_kind = 'event'::text),
  constraint event_details_timezone_fkey FOREIGN KEY (timezone) REFERENCES private.post_event_timezones(name)
);
alter table private.event_details owner to postgres;
alter table private.event_details enable row level security;
CREATE CONSTRAINT TRIGGER core_event_detail AFTER INSERT OR DELETE OR UPDATE ON private.event_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.core_detail_guard();
CREATE TRIGGER core_event_no_truncate BEFORE TRUNCATE ON private.event_details FOR EACH STATEMENT EXECUTE FUNCTION internal.core_no_detail_truncate();
CREATE TRIGGER event_deletion_clock AFTER INSERT OR UPDATE OF ends_at ON private.event_details FOR EACH ROW EXECUTE FUNCTION internal.event_deletion_clock();
CREATE TRIGGER post_edit_event_frozen BEFORE INSERT OR DELETE OR UPDATE ON private.event_details FOR EACH ROW EXECUTE FUNCTION internal.post_edit_guard();
revoke all on private.event_details from public;
