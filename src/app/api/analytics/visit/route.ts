import { isTrackablePath } from "@/lib/site-visits";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  buildViewerKey,
  createAnonymousViewerId,
  ENGAGEMENT_VIEWER_COOKIE,
  ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/engagement";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkLocalRateLimit, getClientRateLimitKey } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("SiteVisitRoute");

const visitSchema = z.object({
  path: z.string().min(1).max(500),
  referrer: z.string().max(500).optional().nullable(),
});

function toOriginOnly(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return ["https:", "http:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("dnt") === "1") {
      return NextResponse.json({ ok: true, recorded: false });
    }
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) {
      return originBlock;
    }

    const parsed = await parseAndValidateJsonRequest(request, visitSchema, {
      invalidJsonMessage: "Invalid visit payload",
      validationErrorMessage: "Invalid visit payload",
      includeValidationDetails: false,
    });
    if (!parsed.success) {
      return parsed.response;
    }

    const { path, referrer } = parsed.data;
    if (!isTrackablePath(path)) {
      return NextResponse.json({ ok: true, recorded: false });
    }

    const rateLimit = checkLocalRateLimit(getClientRateLimitKey(request), "analytics:visit", 240);
    if (rateLimit.limited) {
      return NextResponse.json({ ok: true, recorded: false });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const existingViewerId = request.cookies.get(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null;
    const nextViewerId = existingViewerId ?? createAnonymousViewerId();
    const viewerKey = buildViewerKey(nextViewerId);

    if (!viewerKey) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_site_visit", {
      p_path: path,
      p_referrer: toOriginOnly(referrer),
      p_viewer_key: viewerKey,
      p_user_id: user?.id ?? null,
    });

    if (error) {
      log.error("Failed to record site visit", { path, error: error.message });
      return NextResponse.json({ ok: true, recorded: false });
    }

    const response = NextResponse.json({ ok: true, recorded: Boolean(data) });

    if (!existingViewerId) {
      response.cookies.set({
        name: ENGAGEMENT_VIEWER_COOKIE,
        value: nextViewerId,
        maxAge: ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    }

    return response;
  } catch (error) {
    log.error("Unexpected site visit error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ ok: true, recorded: false });
  }
}
