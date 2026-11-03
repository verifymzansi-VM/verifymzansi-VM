import type { readFoundationPresentedEnquiries } from "./owner-inbox";
type Enquiry = Awaited<ReturnType<typeof readFoundationPresentedEnquiries>>["items"][number];
/** Preserve the selected lead card contract while deriving the subject and
 * contact claims from the caller-bound native inbox DTO. */
export function restoredEnquiry(row: Enquiry) {
  return {
    id: row.id,
    target_id: row.post_id,
    target_type: row.post_kind === "event" ? "promotion" : row.post_kind,
    target_href: `/${row.post_kind === "listing" ? "listing" : row.post_area === "tourism_events" ? "tourism-events" : "mzansi-business"}/${row.post_id}`,
    message: row.message,
    status: row.status,
    buyer_name: row.buyer_name,
    buyer_email: row.buyer_email,
    email_confirmed: row.email_confirmed,
    buyer_phone: row.buyer_phone,
    created_at: row.created_at,
    listings: row.post_title ? { title: row.post_title } : null,
  };
}
