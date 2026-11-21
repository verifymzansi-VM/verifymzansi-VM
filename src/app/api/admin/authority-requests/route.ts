import type { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  authorityRequestRefusal,
  openIdentityDisclosure,
} from "@/lib/foundation/identity-disclosures";

const log = createLogger("AuthorityRequests");

// Bounds and control characters only; the database checks every rule (and
// never searches by name: only these four kinds exist).
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/);
const body = z.strictObject({
  requestType: z.enum(["subpoena", "court_order", "warrant", "police_case", "regulator"]),
  reference: text(1, 100),
  reason: text(1, 2000),
  lookupKind: z.enum(["post", "id_number", "phone", "email"]),
  lookupValue: text(1, 2048),
  attested: z.boolean(),
});

/**
 * POST /api/admin/authority-requests
 *
 * Open a member's kept identity record against an authority request. Same-origin, CSRF and a per-client rate limit
 * (handleFoundationOwnerRoute); the database checks the caller is a governor
 * or admin with an authenticator code from the last 15 minutes, writes the log
 * row before answering (a search that finds nobody is logged too) and answers
 * only the row's id: the record is read on its own page. An ID number is sent
 * to the database only as its one-way fingerprint.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:authority-requests",
    mutate: true,
    maxBytes: 8192,
    signInMessage: "Sign in to open authority requests",
    unavailableMessage:
      "The request could not be confirmed. Reload the page; if a record opened, it is listed under Earlier requests.",
    refusal: authorityRequestRefusal,
    command: async (api, input) => openIdentityDisclosure(api, body.parse(input)),
  });
}
