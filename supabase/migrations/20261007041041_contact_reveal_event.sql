-- Tap-to-reveal: a signed-in visitor revealing a poster's number is recorded
-- as its own contact event, not as a call.
ALTER TYPE public.contact_event_type ADD VALUE IF NOT EXISTS 'reveal';
