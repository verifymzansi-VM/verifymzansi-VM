import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Sponsors");

/**
 * A programme partner as returned by `public_sponsor_directory()`. That one
 * database function decides eligibility for the strip, the home section and
 * /sponsors, so the surfaces never disagree. `logo_url` is null unless written
 * logo permission is on record.
 */
export interface PublicSponsor {
  id: string;
  slug: string;
  name: string;
  organisation_type: string;
  service_area: string | null;
  province: string | null;
  logo_url: string | null;
  programme_status: "founding_trial" | "active_paid";
  live_businesses: number;
  accepting_applications: boolean;
  places_available: boolean;
  on_strip: boolean;
  on_home: boolean;
}

/** Ordered: paid programmes, then founding pilots, then the admin-set order. */
export async function getPublicSponsors(): Promise<PublicSponsor[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("public_sponsor_directory");
    if (error) {
      log.warn("Sponsor directory unavailable", { code: error.code });
      return [];
    }
    return Array.isArray(data) ? (data as PublicSponsor[]) : [];
  } catch (error) {
    log.warn("Sponsor directory unavailable", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }
}

const ORGANISATION_TYPE_LABELS: Record<string, string> = {
  municipality: "Municipality",
  government_department: "Government department",
  led_programme: "Local economic development",
  chamber_of_commerce: "Chamber of commerce",
  tourism_association: "Tourism association",
  incubator: "Business incubator",
  accelerator: "Accelerator",
  enterprise_development: "Enterprise development",
  ngo: "Non-profit organisation",
  supplier_development: "Supplier development",
  mall: "Shopping centre",
  business_association: "Business association",
  cooperative: "Co-operative",
  professional_body: "Professional body",
  university_tvet: "University or TVET college",
  other: "Organisation",
};

export function organisationTypeLabel(type: string): string {
  return ORGANISATION_TYPE_LABELS[type] ?? "Organisation";
}

/** Short area line, e.g. "City of uMhlathuze, KwaZulu-Natal". */
export function sponsorArea(sponsor: Pick<PublicSponsor, "service_area" | "province">): string {
  return [sponsor.service_area, sponsor.province].filter(Boolean).join(", ");
}
