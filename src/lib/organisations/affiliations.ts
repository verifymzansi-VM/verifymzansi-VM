/** Exactly what an organisation sees about an applicant (shown before consent). */
export const SHARED_WITH_ORGANISATION = [
  "Business name, category and location",
  "Public business phone, email and website",
  "Whether your VerifyMzansi identity check is complete (yes/no only)",
  "Your reason and membership reference, if you add them",
] as const;

/** Row returned by the public_business_affiliations RPC. */
export interface PublicAffiliation {
  business_id: string;
  organisation_id: string;
  organisation_slug: string;
  organisation_name: string;
  logo_url: string | null;
  label: string;
  programme_name: string | null;
  confirmed_at: string;
  sponsored: boolean;
  sponsorship_label: string | null;
}
