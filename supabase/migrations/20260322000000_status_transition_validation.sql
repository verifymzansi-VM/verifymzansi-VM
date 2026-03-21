-- Migration: Enforce valid status transitions on content tables
-- Prevents invalid state machine jumps (e.g. rejected → expired, draft → live)

CREATE OR REPLACE FUNCTION validate_listing_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow if status unchanged
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Validate transition against allowed matrix
  IF NOT (
    -- draft → pending_moderation
    (OLD.status = 'draft'              AND NEW.status = 'pending_moderation') OR

    -- pending_moderation → live | rejected | flagged_for_review | hidden
    (OLD.status = 'pending_moderation' AND NEW.status IN ('live', 'rejected', 'flagged_for_review', 'hidden')) OR

    -- flagged_for_review → live | rejected | hidden | pending_moderation
    (OLD.status = 'flagged_for_review' AND NEW.status IN ('live', 'rejected', 'hidden', 'pending_moderation')) OR

    -- live → hidden | expired | flagged_for_review
    (OLD.status = 'live'               AND NEW.status IN ('hidden', 'expired', 'flagged_for_review')) OR

    -- hidden → live | pending_moderation | rejected
    (OLD.status = 'hidden'             AND NEW.status IN ('live', 'pending_moderation', 'rejected')) OR

    -- expired → pending_moderation | draft
    (OLD.status = 'expired'            AND NEW.status IN ('pending_moderation', 'draft')) OR

    -- rejected → pending_moderation | draft
    (OLD.status = 'rejected'           AND NEW.status IN ('pending_moderation', 'draft'))
  ) THEN
    RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all three content tables
CREATE TRIGGER trg_listings_status_transition
  BEFORE UPDATE OF status ON listings
  FOR EACH ROW
  EXECUTE FUNCTION validate_listing_status_transition();

CREATE TRIGGER trg_businesses_status_transition
  BEFORE UPDATE OF status ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION validate_listing_status_transition();

CREATE TRIGGER trg_promotions_status_transition
  BEFORE UPDATE OF status ON promotions
  FOR EACH ROW
  EXECUTE FUNCTION validate_listing_status_transition();
