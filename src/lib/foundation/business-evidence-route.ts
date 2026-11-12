import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "./request-route";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { createFoundationServiceApi } from "./service-api";
import { FoundationSessionError } from "./request-api";
import { foundationNoStore } from "./owner-route";
import { settleStaffCommand, staffCommandRefusal } from "./staff-command";
import { putImmutableR2Bytes } from "../services/storage";
import { decryptData, encryptData } from "../utils/encryption";
import { enforceMutationRequest } from "../utils/mutation-guard";
import { checkRateLimit, getClientRateLimitIdentity } from "../utils/rate-limit";
import { RequestBodyTooLargeError } from "../utils/request-body";
import { createLogger } from "../utils/logger";
import { logRequestFailure } from "../utils/request-failure";

const log = createLogger("NativeBusinessEvidence");
export const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const key = z.string().regex(/^evidence\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/);
export const reservation = z.strictObject({
  artifact_id: z.uuid(),
  owner_id: z.uuid(),
  completed: z.boolean(),
});
export const privateBucket = () => process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";

type Caller = Awaited<
  ReturnType<ReturnType<typeof createFoundationRouteContext>["authenticateCaller"]>
>;
export async function storeBusinessEvidence(
  reserved: z.infer<typeof reservation>,
  caseId: string,
  bytes: Buffer,
  purpose: "business_visit_photo" | "business_reply_attachment" | "registration"
) {
  if (reserved.completed) return;
  const service = createFoundationServiceApi();
  const target = await settleStaffCommand(
    service.rpc(
      "evidence_upload_target",
      {
        p_owner: reserved.owner_id,
        p_artifact: reserved.artifact_id,
      },
      { get: false }
    ),
    z.strictObject({
      case_id: z.literal(caseId),
      artifact_id: z.literal(reserved.artifact_id),
      purpose: z.literal(purpose),
      object_key: key,
    })
  );
  if (!target.object_key.startsWith(`evidence/${caseId}/`))
    throw new Error("Evidence target changed");
  const stored = await putImmutableR2Bytes(
    privateBucket(),
    target.object_key,
    await encryptData(bytes)
  );
  const decrypted = await decryptData(stored);
  if (decrypted.length !== bytes.length || !timingSafeEqual(decrypted, bytes))
    throw new Error("Evidence retry does not match stored bytes");
  const completed = await service.rpc(
    "complete_evidence_upload",
    {
      p_artifact: reserved.artifact_id,
      p_stored_sha256: sha(stored),
      p_content_sha256: sha(bytes),
      p_size: stored.length,
    },
    { get: false }
  );
  if (completed.error) throw new Error("Evidence receipt unavailable");
}
export async function protectBusinessEvidenceRoute(
  incoming: Request,
  action: string,
  mutate: boolean,
  command: (caller: Caller, request: NextRequest) => Promise<NextResponse>
) {
  const request = incoming instanceof NextRequest ? incoming : new NextRequest(incoming);
  if (mutate) {
    const refusal = enforceMutationRequest(request, log);
    if (refusal) return refusal;
  }
  let context: ReturnType<typeof createFoundationRouteContext> | undefined;
  let caller: Caller | undefined;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action,
      degradedMode: "block",
    });
    if (limit.limited || limit.degraded)
      return context.respond(
        NextResponse.json(
          { error: "Evidence access is temporarily limited" },
          {
            status: limit.degraded ? 503 : 429,
            headers: { "Retry-After": String(limit.retryAfter ?? 60) },
          }
        )
      );
    caller = await context.authenticateCaller();
    return context.respond(await command(caller, request));
  } catch (error) {
    let status = 503;
    let message = "The business evidence action could not be confirmed. Reload and try again.";
    let code: string | undefined;
    let reference: string | undefined;
    if (error instanceof RequestBodyTooLargeError) {
      status = 413;
      message = "Files can be up to 5 MB.";
    } else if (error instanceof z.ZodError) {
      status = 400;
      message = "Check the business evidence details.";
    } else if (error instanceof FoundationSessionError && error.status === 401) {
      status = 401;
      message = "Sign in to continue.";
    } else {
      const refusal = staffCommandRefusal(error);
      if (refusal) {
        status = refusal.status;
        message = refusal.error;
        code = refusal.code;
      }
      // Unknown failures and refusals meaning "unavailable" (5xx) are logged.
      if (!refusal || refusal.status >= 500)
        reference = logRequestFailure(log, "Native business evidence request failed", {
          request,
          error,
          api: caller?.api,
          action,
        });
    }
    const response = NextResponse.json(
      { error: message, ...(code ? { code } : {}), ...(reference ? { reference } : {}) },
      { status, headers: foundationNoStore }
    );
    return context ? context.respond(response) : response;
  }
}
