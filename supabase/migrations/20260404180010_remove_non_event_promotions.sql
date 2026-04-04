-- Remove all non-event promotions (confirmed test/seed data only).
-- The platform now only supports event-type promotions.
DELETE FROM promotions WHERE promotion_type != 'event';
