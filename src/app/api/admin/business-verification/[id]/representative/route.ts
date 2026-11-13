import { z } from "zod";

import { handleNativeCipcStaffAction } from "@/lib/foundation/cipc-commands";

const schema = z.object({
  expectedUpdatedAt: z.string().min(10).max(64),
  domainConfirmed: z.boolean(),
  callback: z.object({
    numberSource: z.string().trim().min(5).max(200),
    spokeTo: z.string().trim().min(2).max(120),
    confirmedPosition: z.string().trim().min(2).max(40),
    confirmed: z.boolean(),
    notes: z.string().trim().max(1000).nullable(),
  }),
});

/**
 * POST /api/admin/business-verification/[id]/representative
 * Staff record that the work email's domain is the company's own website and
 * log the call-back: the number's source (found by staff, never supplied by
 * the applicant), who confirmed, and the confirmed position.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleNativeCipcStaffAction(request, (await params).id, "representative", schema.strict());
}
