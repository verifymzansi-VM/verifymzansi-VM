/**
 * The datasets a foundation access export may hold: the names of the registry
 * in internal.frontend_privacy_export_data (database/foundation/current).
 *
 * The staff export route accepts an export only when its dataset names are
 * exactly one of these sets, so a dataset the database renamed, dropped or
 * replaced is refused instead of being handed over silently.
 *
 * A database update that changes the registry needs a website that accepts
 * both the old and the new set first: add the new set here (keeping the old
 * one), release it, apply the update, then remove the old set in a later
 * change. privacy-export-datasets.test.ts checks that the registry in the
 * committed snapshot is one of these sets.
 */
export const PRIVACY_EXPORT_DATASET_SETS: readonly (readonly string[])[] = [
  // Since 20261119172135_post_views_and_likes.sql (42 datasets).
  [
    "profile",
    "account",
    "listing_drafts",
    "posts",
    "post_reviews",
    "media_metadata",
    "payments",
    "invoices",
    "customer_invoices",
    "bank_transfers",
    "entitlements",
    "house_slot_events",
    "slot_packages",
    "package_invoice_requests",
    "post_activations",
    "event_submissions",
    "introductory_trials",
    "posting_terms",
    "signup_terms",
    "communication_choices",
    "verification_cases",
    "verification_reviews",
    "evidence_metadata",
    "phone_verification",
    "locality_verification",
    "enquiries_sent",
    "enquiries_received",
    "post_likes",
    "post_likes_summary",
    "notifications",
    "reports_submitted",
    "moderation_decisions",
    "appeals",
    "organisation_applications",
    "organisation_affiliations",
    "organisation_roles",
    "sponsorships",
    "partner_account",
    "partner_commissions",
    "acquisition",
    "account_closure",
    "data_requests",
  ],
];

/** Whether `names` (an export's dataset names) is exactly one accepted set:
 * the same names, none missing and none extra. */
export function isAcceptedPrivacyExportDatasetSet(
  names: readonly string[],
  sets: readonly (readonly string[])[] = PRIVACY_EXPORT_DATASET_SETS
): boolean {
  const given = new Set(names);
  if (given.size !== names.length) return false;
  return sets.some((set) => set.length === given.size && set.every((name) => given.has(name)));
}
