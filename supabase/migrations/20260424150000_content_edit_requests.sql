-- Live content edit requests.
-- Owners can propose edits to live posts while the approved version remains public.

DO $$
BEGIN
  CREATE TYPE content_edit_target_type AS ENUM ('listing', 'business', 'promotion');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE content_edit_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS approved_edit_count INTEGER NOT NULL DEFAULT 0
  CHECK (approved_edit_count >= 0);

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS approved_edit_count INTEGER NOT NULL DEFAULT 0
  CHECK (approved_edit_count >= 0);

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS approved_edit_count INTEGER NOT NULL DEFAULT 0
  CHECK (approved_edit_count >= 0);

CREATE TABLE IF NOT EXISTS content_edit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type content_edit_target_type NOT NULL,
  target_id UUID NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area marketplace_area NOT NULL,
  status content_edit_status NOT NULL DEFAULT 'pending',
  proposed_data JSONB NOT NULL,
  current_snapshot JSONB NOT NULL,
  reason TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_edit_requests_one_pending
  ON content_edit_requests(target_type, target_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_content_edit_requests_queue
  ON content_edit_requests(status, area, created_at);

CREATE INDEX IF NOT EXISTS idx_content_edit_requests_owner
  ON content_edit_requests(owner_id, status, created_at DESC);

DROP TRIGGER IF EXISTS update_content_edit_requests_updated_at ON content_edit_requests;
CREATE TRIGGER update_content_edit_requests_updated_at
  BEFORE UPDATE ON content_edit_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE content_edit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads own content edit requests" ON content_edit_requests;
CREATE POLICY "Owner reads own content edit requests" ON content_edit_requests
  FOR SELECT
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Staff reads all content edit requests" ON content_edit_requests;
CREATE POLICY "Staff reads all content edit requests" ON content_edit_requests
  FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));

DROP POLICY IF EXISTS "Staff updates content edit requests" ON content_edit_requests;
CREATE POLICY "Staff updates content edit requests" ON content_edit_requests
  FOR UPDATE
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
