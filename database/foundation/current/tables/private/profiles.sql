-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.profiles (
  account_id uuid not null,
  display_name text,
  bio text,
  legal_first_name text,
  legal_last_name text,
  legal_name_locked_at timestamp with time zone,
  legal_name_fact_id uuid,
  avatar_object_id uuid,
  revision integer default 1 not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  updated_at timestamp with time zone default statement_timestamp() not null,
  constraint profiles_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint profiles_avatar_object_id_fkey FOREIGN KEY (avatar_object_id) REFERENCES private.media_objects(id) ON DELETE RESTRICT,
  constraint profiles_avatar_object_id_key UNIQUE (avatar_object_id),
  constraint profiles_bio_check CHECK (bio IS NULL OR internal.profile_bio_valid(bio)),
  constraint profiles_check CHECK ((legal_first_name IS NULL) = (legal_last_name IS NULL)),
  constraint profiles_check1 CHECK ((legal_name_locked_at IS NULL) = (legal_name_fact_id IS NULL)),
  constraint profiles_check2 CHECK (legal_name_locked_at IS NULL OR legal_first_name IS NOT NULL),
  constraint profiles_check3 CHECK (display_name IS NULL OR internal.person_name_valid(display_name) OR legal_name_locked_at IS NOT NULL AND display_name = ((legal_first_name || ' '::text) || legal_last_name)),
  constraint profiles_legal_first_name_check CHECK (legal_first_name IS NULL OR internal.person_name_valid(legal_first_name)),
  constraint profiles_legal_last_name_check CHECK (legal_last_name IS NULL OR internal.person_name_valid(legal_last_name)),
  constraint profiles_pkey PRIMARY KEY (account_id),
  constraint profiles_revision_check CHECK (revision >= 1 AND revision <= 2147483647)
);
alter table private.profiles owner to postgres;
alter table private.profiles enable row level security;
CREATE INDEX profiles_avatar_idx ON private.profiles USING btree (avatar_object_id) WHERE (avatar_object_id IS NOT NULL);
CREATE TRIGGER profile_guard BEFORE INSERT OR UPDATE ON private.profiles FOR EACH ROW EXECUTE FUNCTION internal.profile_guard();
revoke all on private.profiles from public;
