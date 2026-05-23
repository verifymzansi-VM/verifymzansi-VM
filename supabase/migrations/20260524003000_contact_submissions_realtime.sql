DO $$
BEGIN
  IF to_regclass('public.contact_submissions') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'contact_submissions'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_submissions;
  END IF;
END $$;
