import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import {
  readFoundationEvidenceBytes,
  FoundationVerificationError,
} from "@/lib/foundation/verification-runtime";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit } from "@/lib/utils/rate-limit";
const log = createLogger("FoundationEvidence");
const headers = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};
export async function POST(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return NextResponse.json(
      { error: "Evidence is temporarily unavailable" },
      { status: 503, headers }
    );
  }
  try {
    const caller = await context.authenticateCaller();
    const limit = await checkRateLimit({
      key: caller.accountId,
      action: "admin:evidence:view",
      degradedMode: "block",
    });
    if (limit.limited)
      return context.respond(
        NextResponse.json(
          { error: "Evidence protection unavailable or too many requests" },
          { status: limit.degraded ? 503 : 429, headers }
        )
      );
    const value = z
      .strictObject({
        case_id: z.uuid(),
        claim_generation: z.string().regex(/^[1-9]\d{0,18}$/),
        claim_nonce: z.uuid(),
        artifact_id: z.uuid(),
      })
      .parse(await parseJsonRequest(request, { maxBytes: 4096 }));
    const evidence = await readFoundationEvidenceBytes(
      caller.api,
      createFoundationServiceApi(),
      {
        case_id: value.case_id,
        claim_generation: value.claim_generation,
        claim_nonce: value.claim_nonce,
      },
      value.artifact_id
    );
    return context.respond(
      new NextResponse(evidence.bytes, {
        headers: {
          ...headers,
          "Content-Type": evidence.mime,
          "Content-Disposition": `inline; filename="verification-evidence.${evidence.mime === "application/pdf" ? "pdf" : "image"}"`,
        },
      })
    );
  } catch (error) {
    const status =
      error instanceof FoundationVerificationError || error instanceof FoundationSessionError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503;
    return context.respond(
      NextResponse.json(
        { error: "Evidence is unavailable, the claim expired or permission changed" },
        { status, headers }
      )
    );
  }
}
