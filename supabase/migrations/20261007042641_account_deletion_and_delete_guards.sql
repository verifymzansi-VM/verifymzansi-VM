-- Account deletion and content deletion guards (posting audit 2026-10-07).
--
-- 1. Deleting an account failed for anyone who had posted, received an
--    enquiry or paid: these foreign keys to auth.users had no ON DELETE rule.
--    The account holder's posts, enquiries, contact analytics and consents go
--    with the account; payments and invoices stay for tax records, unlinked.
--    Staff references in verification records are unlinked, not deleted.
-- 2. Business verification documents are queued for storage deletion when
--    their rows go (they were left in the private bucket), and the staff
--    evidence-access log survives the case.
-- 3. Nobody deletes posts of an owner under legal hold, and owners can't
--    delete posts that are suspended or flagged (they are evidence).

-- 1. Account deletion -------------------------------------------------------
ALTER TABLE public.listings DROP CONSTRAINT listings_owner_id_fkey,
  ADD CONSTRAINT listings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.businesses DROP CONSTRAINT businesses_owner_id_fkey,
  ADD CONSTRAINT businesses_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.promotions DROP CONSTRAINT promotions_owner_id_fkey,
  ADD CONSTRAINT promotions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.leads DROP CONSTRAINT leads_owner_id_fkey,
  ADD CONSTRAINT leads_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_owner_id_fkey,
  ADD CONSTRAINT contact_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.consent_records DROP CONSTRAINT consent_records_user_id_fkey,
  ADD CONSTRAINT consent_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.payments ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT payments_user_id_fkey,
  ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT invoices_user_id_fkey,
  ADD CONSTRAINT invoices_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.business_verifications DROP CONSTRAINT business_verifications_reviewed_by_fkey,
  ADD CONSTRAINT business_verifications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.business_verification_files ALTER COLUMN uploaded_by DROP NOT NULL,
  DROP CONSTRAINT business_verification_files_uploaded_by_fkey,
  ADD CONSTRAINT business_verification_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.business_verification_messages ALTER COLUMN author_id DROP NOT NULL,
  DROP CONSTRAINT business_verification_messages_author_id_fkey,
  ADD CONSTRAINT business_verification_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Verification documents and the access log -----------------------------
ALTER TABLE public.business_verification_evidence_access_logs ALTER COLUMN actor_id DROP NOT NULL,
  DROP CONSTRAINT business_verification_evidence_access_logs_actor_id_fkey,
  ADD CONSTRAINT business_verification_evidence_access_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.business_verification_evidence_access_logs ALTER COLUMN case_id DROP NOT NULL,
  DROP CONSTRAINT business_verification_evidence_access_logs_case_id_fkey,
  ADD CONSTRAINT business_verification_evidence_access_logs_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.business_verifications(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.queue_business_verification_file_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.r2_key IS NOT NULL AND OLD.purged_at IS NULL THEN
    INSERT INTO public.r2_cleanup_queue (bucket, r2_key, reason)
    SELECT 'private', OLD.r2_key, 'business_verification_deleted'
     WHERE NOT EXISTS (SELECT 1 FROM public.r2_cleanup_queue q
                        WHERE q.r2_key = OLD.r2_key AND q.processed_at IS NULL);
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.queue_business_verification_file_cleanup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS queue_business_verification_file_cleanup ON public.business_verification_files;
CREATE TRIGGER queue_business_verification_file_cleanup
  AFTER DELETE ON public.business_verification_files
  FOR EACH ROW EXECUTE FUNCTION public.queue_business_verification_file_cleanup();

-- 3. Content delete guards ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_content_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.account_profiles ap
              WHERE ap.user_id = OLD.owner_id AND ap.legal_hold) THEN
    RAISE EXCEPTION 'content_under_legal_hold' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF auth.role() = 'authenticated' AND NOT public.has_role('admin')
     AND OLD.status::text IN ('suspended', 'flagged_for_review') THEN
    RAISE EXCEPTION 'content_under_review' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_content_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_content_delete ON public.listings;
CREATE TRIGGER guard_content_delete BEFORE DELETE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.guard_content_delete();
DROP TRIGGER IF EXISTS guard_content_delete ON public.businesses;
CREATE TRIGGER guard_content_delete BEFORE DELETE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.guard_content_delete();
DROP TRIGGER IF EXISTS guard_content_delete ON public.promotions;
CREATE TRIGGER guard_content_delete BEFORE DELETE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.guard_content_delete();
