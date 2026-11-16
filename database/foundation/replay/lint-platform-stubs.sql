-- Lint only: applied after the replay, in the throwaway plpgsql_check database.
-- Never apply this to a hosted project. It declares Supabase platform functions
-- that foundation code calls through guarded dynamic SQL, so plpgsql_check can
-- verify those calls against the real signatures instead of reporting a
-- missing schema. Bodies do nothing.
create schema realtime;
-- Supabase Realtime broadcast helper.
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language plpgsql as $$ begin end $$;
-- Hosted Auth tables that the account erasure clears through guarded dynamic
-- SQL (20261116175757_close_and_erase_account.sql); only the columns it uses.
create table auth.identities (id uuid primary key, user_id uuid not null);
create table auth.refresh_tokens (id bigint primary key, user_id varchar(255), session_id uuid);
create table auth.one_time_tokens (id uuid primary key, user_id uuid not null);
create table auth.flow_state (id uuid primary key, user_id uuid);
