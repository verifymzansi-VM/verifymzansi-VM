-- Lint only: applied after the replay, in the throwaway plpgsql_check database.
-- Never apply this to a hosted project. It declares Supabase platform functions
-- that foundation code calls through guarded dynamic SQL, so plpgsql_check can
-- verify those calls against the real signatures instead of reporting a
-- missing schema. Bodies do nothing.
create schema realtime;
-- Supabase Realtime broadcast helper.
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language plpgsql as $$ begin end $$;
