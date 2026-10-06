-- Self-typed CIPC numbers are retired: CIPC registration is now verified from
-- documents by staff (docs/business-verification-spec.md §7). Delete every
-- stored copy, including pending content-edit proposals, and tell each
-- affected owner how to get the verified CIPC sticker instead.

WITH affected AS (
  UPDATE public.businesses b
  SET category_details = jsonb_set(
    b.category_details,
    '{business_profile}',
    (b.category_details -> 'business_profile') - 'cipc_registration'
  )
  WHERE b.category_details -> 'business_profile' ? 'cipc_registration'
  RETURNING b.owner_id
)
INSERT INTO public.notifications (user_id, type, title, message, href)
SELECT DISTINCT a.owner_id, 'info', 'CIPC registration is now verified',
  'We removed the CIPC number typed on your business profile. Upload a CIPC document to get the CIPC Registered sticker, checked by our team.',
  '/dashboard/listings?area=MZANSI_BUSINESS'
FROM affected a
WHERE a.owner_id IS NOT NULL;

UPDATE public.content_edit_requests r
SET proposed_data = jsonb_set(
  r.proposed_data,
  '{category_details,business_profile}',
  (r.proposed_data -> 'category_details' -> 'business_profile') - 'cipc_registration'
)
WHERE r.proposed_data -> 'category_details' -> 'business_profile' ? 'cipc_registration';
