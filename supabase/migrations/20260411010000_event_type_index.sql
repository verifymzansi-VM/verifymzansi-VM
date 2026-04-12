-- Index for filtering events by event_type stored in JSONB event_details column.
-- Improves query performance for: event_details->>'event_type' = ?
CREATE INDEX IF NOT EXISTS idx_promotions_event_type
  ON promotions ((event_details->>'event_type'))
  WHERE promotion_type = 'event';
