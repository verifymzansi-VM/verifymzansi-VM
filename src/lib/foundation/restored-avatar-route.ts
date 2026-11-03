import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "./request-route";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { createFoundationServiceApi } from "./service-api";
import { FoundationSessionError } from "./request-api";
import { uploadFoundationMedia, FoundationMediaError } from "./media-upload";
import { setFoundationAvatar, FoundationProfileError } from "./account-profile";
import { enforceMutationRequest } from "../utils/mutation-guard";
import { checkRateLimit, getClientRateLimitIdentity } from "../utils/rate-limit";
import { createLogger } from "../utils/logger";
import { readBoundedRequestFormData, RequestBodyTooLargeError } from "../utils/request-body";
import { foundationNoStore } from "@/app/api/foundation/_lib/owner-route";

const log = createLogger("RestoredAvatar");
export async function handleRestoredAvatarUpload(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return NextResponse.json(
      { error: "Avatar upload is temporarily unavailable" },
      { status: 503, headers: foundationNoStore }
    );
  }
  const reply = (status: number, error: string) =>
    context.respond(NextResponse.json({ error }, { status }));
  try {
    const ipLimit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "profile:avatar",
      degradedMode: "block",
    });
    if (ipLimit.degraded || ipLimit.limited)
      return reply(
        ipLimit.degraded ? 503 : 429,
        "Upload protection is unavailable or too many attempts were made"
      );
    const caller = await context.authenticateCaller();
    const limit = await checkRateLimit({
      key: caller.accountId,
      action: "profile:avatar",
      degradedMode: "block",
    });
    if (limit.degraded || limit.limited)
      return reply(
        limit.degraded ? 503 : 429,
        "Upload protection is unavailable or too many attempts were made"
      );
    const form = await readBoundedRequestFormData(request, 3 * 1024 * 1024);
    if (
      [...form.keys()].some((key) => !["file", "expectedRevision"].includes(key)) ||
      form.getAll("file").length !== 1 ||
      form.getAll("expectedRevision").length !== 1
    )
      return reply(400, "Reload your profile and choose one photo");
    const file = form.get("file");
    const raw = form.get("expectedRevision");
    const revision = typeof raw === "string" && /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(revision) || revision > 2147483646)
      return reply(400, "Reload your profile before changing your avatar");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > 2 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )
      return reply(400, "Choose a JPEG, PNG or WebP image under 2 MB");
    const media = await uploadFoundationMedia(caller.api, createFoundationServiceApi(), file);
    if (media.kind !== "image") throw new FoundationMediaError(400);
    // Never overwrite the previous object or retry an uncertain link. If the
    // revision is stale, the unused new object remains in the native journal
    // for retention cleanup; the current avatar remains referenced and intact.
    const profile = await setFoundationAvatar(caller.api, {
      expected_revision: revision,
      object_id: media.object_id,
    });
    return context.respond(
      NextResponse.json({ success: true, avatarUrl: media.url, revision: profile.revision })
    );
  } catch (error) {
    if (error instanceof FoundationSessionError)
      return reply(
        error.status,
        error.status === 401
          ? "Sign in to change your avatar"
          : "Avatar upload is temporarily unavailable"
      );
    if (error instanceof RequestBodyTooLargeError) return reply(413, "Choose an image under 2 MB");
    if (error instanceof FoundationMediaError)
      return reply(
        error.status,
        "The image could not be uploaded. Check the format and storage allowance"
      );
    if (error instanceof FoundationProfileError)
      return reply(
        error.reason === "changed" ? 412 : error.reason === "unavailable" ? 503 : 400,
        error.reason === "changed"
          ? "Your profile changed. Reload it before changing your avatar"
          : "Your avatar could not be saved"
      );
    return reply(503, "Avatar upload is temporarily unavailable");
  }
}
