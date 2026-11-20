import type { Finding, NameMatch, SuggestedStep } from "@/lib/cipc/screen";

import type { RegisteredOfficeView } from "./public";

export const QUEUE_TABS = [
  { key: "review", label: "CIPC" },
  { key: "representatives", label: "Representatives" },
  { key: "visits", label: "Visits" },
  { key: "conflicts", label: "Conflicts" },
  { key: "renewals", label: "Renewals" },
  { key: "exceptions", label: "Second review" },
  { key: "waiting", label: "Waiting on owner" },
  { key: "decided", label: "Decided" },
] as const;
export type QueueTab = (typeof QUEUE_TABS)[number]["key"];

type Director = {
  name: string;
  role: string | null;
  hasSaId: boolean;
  isOwner: boolean;
  nameMatch: NameMatch | null;
};

/** One business verification case as the staff case view shows it
 * (src/lib/foundation/business-cipc.ts reads it from the live backend). */
export type CaseDetail = {
  id: string;
  kind: "cipc" | "cipc_link" | "seen";
  route: string | null;
  status: string;
  updatedAt: string;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
  reasonCode: string | null;
  reviewNote: string | null;
  registrationNumber: string | null;
  docType: string | null;
  ownerId: string;
  business: {
    id: string;
    business_name: string | null;
    slug: string | null;
    status: string;
    location_city: string | null;
    location_province: string | null;
    cipc_verified_at: string | null;
    cipc_registration_number: string | null;
  } | null;
  owner: {
    displayName: string | null;
    legalName: string | null;
    idReviewed: boolean;
    hasIdHash: boolean;
  };
  parsed: {
    registeredName: string | null;
    registrationNumber: string | null;
    enterpriseStatus: string | null;
    issuedOn: string | null;
    registeredOfficeLines: string[];
    directors: Director[];
  };
  ownerMatchOnUpload: string | null;
  adminCopy: {
    registrationNumber: string | null;
    registeredName: string | null;
    enterpriseStatus: string | null;
    directors: Director[];
    registeredOffice: RegisteredOfficeView | null;
    /** The office as printed on the official copy. */
    registeredOfficeLines?: string[];
    cipcReference: string | null;
    differences: Array<{ field: string; owner: string | null; cipc: string | null }>;
  } | null;
  registeredOffice: Record<string, unknown> | null;
  representative: Record<string, unknown> | null;
  seen: Record<string, unknown> | null;
  checks: {
    exception?: { proposedBy?: string; reason?: string; confirmedBy?: string };
  } | null;
  findings: Finding[];
  suggestion: SuggestedStep;
  /** What an approval would rest on, and what is still missing. */
  evidence: {
    ready: boolean;
    missing: string[];
    /** Gaps a two-person exception may never waive. */
    unwaivable: string[];
    role: "director" | "member" | "representative" | null;
    position: string | null;
    registeredName: string | null;
  } | null;
  files: Array<{
    id: string;
    kind: string;
    content_type: string;
    size_bytes: number;
    producer: string | null;
    revision_count: number | null;
    quarantined: boolean;
    created_at: string;
    purged_at: string | null;
  }>;
  messages: Array<{
    id: string;
    author_role: string;
    author_id: string | null;
    body: string;
    attachment_file_id: string | null;
    created_at: string;
  }>;
  accessLog: Array<{ actor_id: string; action: string; created_at: string }>;
} | null;
