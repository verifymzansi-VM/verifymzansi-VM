-- Business verification: CIPC Registered and Seen by VerifyMzansi stickers.
-- Spec: docs/business-verification-spec.md. Staff decide every case; owners
-- read and write their cases only through service-role API routes, which leave
-- out staff-only fields. Raw ID numbers are never stored here, only HMACs.

-- ── Cases ────────────────────────────────────────────────────────────────
CREATE TABLE public.business_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('cipc', 'cipc_link', 'seen')),
  route text CHECK (route IN ('director', 'representative')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'info_requested', 'approved', 'rejected', 'revoked', 'expired', 'withdrawn')),
  registration_number text CHECK (registration_number ~ '^\d{4}/\d{6}/\d{2}$'),
  doc_type text,
  -- Parsed owner upload without raw ID numbers (names, roles, status, office).
  parsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  director_id_hmacs text[] NOT NULL DEFAULT '{}',
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  registered_office jsonb,
  -- Staff-fetched CIPC copy: parsed fields, CIPC reference, comparison.
  admin_copy jsonb,
  -- Representative route: work-email code status and call-back log.
  representative jsonb,
  -- Seen sticker: method, preferred slots, assignment, verifier report.
  seen jsonb,
  -- cipc_link: the approved case for the same company this profile joins.
  linked_case_id uuid REFERENCES public.business_verifications(id) ON DELETE SET NULL,
  -- Reviewer ticks recorded with the decision.
  checks jsonb,
  reviewed_by uuid REFERENCES auth.users(id),
  reason_code text,
  review_note text CHECK (char_length(review_note) <= 2000),
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'seen' OR registration_number IS NOT NULL)
);

-- One open case per business and sticker.
CREATE UNIQUE INDEX business_verifications_one_open
  ON public.business_verifications (business_id, (CASE WHEN kind = 'seen' THEN 'seen' ELSE 'cipc' END))
  WHERE status IN ('pending', 'info_requested');
CREATE INDEX business_verifications_queue
  ON public.business_verifications (status, kind, created_at)
  WHERE status IN ('pending', 'info_requested');
CREATE INDEX business_verifications_number
  ON public.business_verifications (registration_number)
  WHERE registration_number IS NOT NULL;
CREATE INDEX business_verifications_owner ON public.business_verifications (owner_id);
CREATE INDEX business_verifications_business ON public.business_verifications (business_id);
CREATE INDEX business_verifications_expiry
  ON public.business_verifications (expires_at) WHERE status = 'approved';
CREATE INDEX business_verifications_linked
  ON public.business_verifications (linked_case_id) WHERE linked_case_id IS NOT NULL;
CREATE INDEX business_verifications_reviewer
  ON public.business_verifications (reviewed_by) WHERE reviewed_by IS NOT NULL;

CREATE TRIGGER set_business_verifications_updated_at
  BEFORE UPDATE ON public.business_verifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Files (encrypted in the private R2 bucket) ───────────────────────────
CREATE TABLE public.business_verification_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.business_verifications(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('owner_upload', 'admin_copy', 'visit_photo', 'message_attachment')),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  r2_key text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  producer text,
  revision_count integer,
  -- Active content found: staff see extracted text only, never the file.
  quarantined boolean NOT NULL DEFAULT false,
  extracted_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz,
  purged_at timestamptz
);
CREATE INDEX business_verification_files_case ON public.business_verification_files (case_id);
CREATE INDEX business_verification_files_sha ON public.business_verification_files (sha256);
CREATE INDEX business_verification_files_purge
  ON public.business_verification_files (purge_after) WHERE purged_at IS NULL;

-- ── Messages between staff and the owner ─────────────────────────────────
CREATE TABLE public.business_verification_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.business_verifications(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  author_role text NOT NULL CHECK (author_role IN ('owner', 'staff')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  attachment_file_id uuid REFERENCES public.business_verification_files(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX business_verification_messages_case
  ON public.business_verification_messages (case_id, created_at);

-- ── Evidence access log (fail-closed in the evidence route) ──────────────
CREATE TABLE public.business_verification_evidence_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  actor_role text NOT NULL,
  case_id uuid NOT NULL REFERENCES public.business_verifications(id) ON DELETE CASCADE,
  file_id uuid REFERENCES public.business_verification_files(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('view_file', 'reveal_id')),
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_verification_access_case
  ON public.business_verification_evidence_access_logs (case_id, created_at DESC);
CREATE INDEX business_verification_access_file
  ON public.business_verification_evidence_access_logs (file_id) WHERE file_id IS NOT NULL;
CREATE INDEX business_verification_access_actor
  ON public.business_verification_evidence_access_logs (actor_id);
CREATE INDEX business_verification_files_uploader
  ON public.business_verification_files (uploaded_by);
CREATE INDEX business_verification_messages_author
  ON public.business_verification_messages (author_id);
CREATE INDEX business_verification_messages_attachment
  ON public.business_verification_messages (attachment_file_id) WHERE attachment_file_id IS NOT NULL;

-- ── Sticker state on businesses (staff/service writes only) ──────────────
ALTER TABLE public.businesses
  ADD COLUMN cipc_verified_at timestamptz,
  ADD COLUMN cipc_expires_at timestamptz,
  ADD COLUMN cipc_registration_number text,
  ADD COLUMN cipc_registered_name text,
  ADD COLUMN cipc_registered_office jsonb,
  ADD COLUMN show_full_registered_office boolean NOT NULL DEFAULT false,
  ADD COLUMN seen_verified_at timestamptz,
  ADD COLUMN seen_expires_at timestamptz,
  ADD COLUMN seen_method text CHECK (seen_method IN ('visit', 'video')),
  ADD COLUMN seen_city text,
  ADD COLUMN owner_verified_role text CHECK (owner_verified_role IN ('director', 'member', 'representative')),
  ADD COLUMN owner_position_title text CHECK (char_length(owner_position_title) <= 40);

CREATE OR REPLACE FUNCTION public.guard_business_verification_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  verification_cols text[] := ARRAY[
    'cipc_verified_at', 'cipc_expires_at', 'cipc_registration_number', 'cipc_registered_name',
    'cipc_registered_office', 'show_full_registered_office', 'seen_verified_at',
    'seen_expires_at', 'seen_method', 'seen_city', 'owner_verified_role', 'owner_position_title'];
  col text;
BEGIN
  -- A new owner does not inherit the previous owner's verification.
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    NEW.cipc_verified_at := NULL; NEW.cipc_expires_at := NULL;
    NEW.cipc_registration_number := NULL; NEW.cipc_registered_name := NULL;
    NEW.cipc_registered_office := NULL; NEW.show_full_registered_office := false;
    NEW.seen_verified_at := NULL; NEW.seen_expires_at := NULL;
    NEW.seen_method := NULL; NEW.seen_city := NULL;
    NEW.owner_verified_role := NULL; NEW.owner_position_title := NULL;
    UPDATE public.business_verifications SET status = 'revoked', reason_code = 'ownership_changed'
      WHERE business_id = NEW.id AND status IN ('approved', 'pending', 'info_requested');
    RETURN NEW;
  END IF;

  IF auth.role() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  FOREACH col IN ARRAY verification_cols LOOP
    IF TG_OP = 'INSERT' THEN
      IF to_jsonb(NEW) -> col IS NOT NULL AND to_jsonb(NEW) -> col <> 'null'::jsonb
         AND NOT (col = 'show_full_registered_office' AND to_jsonb(NEW) -> col = 'false'::jsonb) THEN
        RAISE EXCEPTION 'Verification fields are set by VerifyMzansi staff'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION 'Verification fields are set by VerifyMzansi staff'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_business_verification_columns() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_business_verification_columns
  BEFORE INSERT OR UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.guard_business_verification_columns();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.business_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_verification_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_verification_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_verification_evidence_access_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.business_verifications, public.business_verification_files,
  public.business_verification_messages, public.business_verification_evidence_access_logs
  FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.business_verifications, public.business_verification_files,
  public.business_verification_messages, public.business_verification_evidence_access_logs
  FROM authenticated;

-- Owners read their cases only through the API, which leaves out staff-only
-- fields (forensic findings, the admin's CIPC copy, work-email code hashes).
CREATE POLICY "Staff read verification cases" ON public.business_verifications
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['moderator', 'governance_controller', 'admin']));

-- Files hold storage keys: staff only.
CREATE POLICY "Staff read verification files" ON public.business_verification_files
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['moderator', 'governance_controller', 'admin']));

CREATE POLICY "Staff read verification messages" ON public.business_verification_messages
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['moderator', 'governance_controller', 'admin']));

CREATE POLICY "Admins read evidence access logs" ON public.business_verification_evidence_access_logs
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['governance_controller', 'admin']));
