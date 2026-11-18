/**
 * POST /api/sample-posts/contact
 * VerifyMzansi's own Call and WhatsApp numbers for a sample page, shown only
 * after the visitor clicks (the site's contact rule: never openly, never
 * needing sign-in). Same origin and CSRF, a per-visitor limit, and only for a
 * sample that is shown now (switch on, not removed by staff).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkLocalRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { isSampleSlug } from "@/lib/sample-posts/catalogue";
import { readSampleContact } from "@/lib/sample-posts/contact";
import { findSamplePost } from "@/lib/sample-posts/load";

const log = createLogger("SamplePostContact");
const noStore = { "Cache-Control": "private, no-store" };
const body = z.strictObject({ slug: z.string().refine(isSampleSlug) });

export async function POST(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const { limited, retryAfter } = checkLocalRateLimit(
    getClientRateLimitIdentity(request).key,
    "sample-posts:contact",
    20
  );
  if (limited)
    return NextResponse.json(
      { error: "Too many requests; try again shortly" },
      { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter ?? 60) } }
    );
  const parsed = body.safeParse(await parseJsonRequest(request, { maxBytes: 512 }));
  if (!parsed.success)
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  const contact = readSampleContact();
  if (!contact || !(await findSamplePost(parsed.data.slug)))
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  return NextResponse.json(contact, { headers: noStore });
}
