-- Enquiry reply addresses (posting audit 2026-10-07). Anyone can type any
-- email into the enquiry form, so a seller couldn't tell a buyer's own
-- address from someone else's. email_confirmed is true only when the sender
-- was signed in and the reply address is their confirmed account email.
-- The sender's account id is deliberately not stored on the lead (sellers
-- can read their leads).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS email_confirmed boolean NOT NULL DEFAULT false;
