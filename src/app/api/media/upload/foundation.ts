import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import {
  uploadFoundationMedia,
  FoundationMediaError,
  type FoundationUploadedMedia,
} from "@/lib/foundation/media-upload";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { readBoundedRequestFormData, RequestBodyTooLargeError } from "@/lib/utils/request-body";
const log = createLogger("FoundationMediaUpload");

export async function uploadFoundationMediaRequest(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  try {
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "media:upload",
      degradedMode: "block",
    });
    if (limit.limited)
      return context.respond(
        NextResponse.json(
          { error: "Upload protection unavailable or rate limit exceeded" },
          { status: limit.degraded ? 503 : 429 }
        )
      );
    const caller = await context.authenticateCaller();
    const form = await readBoundedRequestFormData(request, 52428800 + 1048576);
    const files = form
      .getAll("files")
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length || files.length > 10)
      return context.respond(
        NextResponse.json({ error: "Choose one to ten media files" }, { status: 400 })
      );
    const objects: FoundationUploadedMedia[] = [];
    const errors: string[] = [];
    let status = 400;
    for (const file of files) {
      try {
        objects.push(await uploadFoundationMedia(caller.api, createFoundationServiceApi(), file));
      } catch (error) {
        status = error instanceof FoundationMediaError ? error.status : 503;
        errors.push("A file could not be uploaded. Check the format and storage allowance.");
      }
    }
    return context.respond(
      NextResponse.json(
        {
          success: !errors.length,
          urls: objects.map((item) => item.url),
          objects,
          ...(errors.length ? { errors } : {}),
        },
        { status: errors.length ? (objects.length ? 207 : status) : 200 }
      )
    );
  } catch (error) {
    const status =
      error instanceof FoundationSessionError
        ? error.status
        : error instanceof RequestBodyTooLargeError
          ? 413
          : 503;
    return context.respond(
      NextResponse.json(
        {
          error: status === 401 ? "Sign in to upload media" : "Media upload could not be completed",
        },
        { status }
      )
    );
  }
}
