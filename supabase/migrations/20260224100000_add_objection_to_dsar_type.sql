-- Add 'objection' to dsar_type enum to match frontend/API contract
-- (POPIA Section 11(3)(a) right to object to processing)
ALTER TYPE dsar_type ADD VALUE IF NOT EXISTS 'objection';
