-- Server-side draft persistence for create-post wizards.
-- One draft per (user, flow) – upserted on save.

CREATE TABLE IF NOT EXISTS public.listing_drafts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flow       text NOT NULL CHECK (flow IN ('listing', 'promotion', 'business')),
  step       int  NOT NULL DEFAULT 0,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, flow)
);

-- RLS: users can only access their own drafts.
ALTER TABLE public.listing_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own drafts"
  ON public.listing_drafts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
