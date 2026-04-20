-- ============================================================
-- RLS HARDENING: Explicit direct-table policy for content_likes
-- Ticket: Supabase Security Advisor follow-up 2026-04-21
-- ============================================================

COMMENT ON TABLE public.content_likes IS
  'Content likes are written and aggregated through SECURITY DEFINER RPCs. Direct table reads remain restricted to staff for audits and advisor compliance.';

CREATE POLICY "Staff reads content likes"
  ON public.content_likes
  FOR SELECT
  USING ((select public.has_any_role(ARRAY['moderator', 'admin'])));