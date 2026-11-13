import { z } from "zod";

import { handleNativeCipcStaffAction } from "@/lib/foundation/cipc-commands";

const text = (max: number) => z.string().trim().max(max).nullable();
const schema = z.object({
  expectedUpdatedAt: z.string().min(10).max(64),
  streetLines: z.array(z.string().trim().min(1).max(120)).max(3),
  suburb: text(80),
  city: z.string().trim().min(1).max(80),
  province: z.string().trim().min(1).max(50),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{4}$/)
    .nullable(),
});

/**
 * PATCH /api/admin/business-verification/[id]/office
 * Staff correct how we read the registered office before approving.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleNativeCipcStaffAction(request, (await params).id, "office", schema.strict());
}
