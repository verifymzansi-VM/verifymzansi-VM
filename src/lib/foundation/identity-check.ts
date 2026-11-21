import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { createFoundationServiceApi, type FoundationServiceApi } from "./service-api";
import { handleFoundationOwnerRoute, type FoundationRefusal } from "./owner-route";
import { lookupDatabaseReason, type FoundationErrorReason } from "./error-reasons";
import { FoundationVerificationError } from "./verification-runtime";
import {
  createDiditSession,
  diditConfig,
  DiditError,
  type DiditUnavailableReason,
} from "./didit-client";
import { deviceOfUserAgent, networkHash } from "./identity-check-context";
import { sendStaffOperationsEmail } from "../services/email";
import { SUPPORT_CONTACT_EMAIL } from "../contact-email";
import { getClientIp } from "../utils/rate-limit";
import { createLogger } from "../utils/logger";

/**
 * Automatic ID checks, member side (Didit plan, build step 6): the routes
 * behind the verification page (availability, start, ask a person), the
 * pause with its one staff alert, and the guard that keeps the photo routes
 * closed while the automatic route is open. While the setting is "manual"
 * (its starting value) the database answers route "manual" and refuses a
 * start, so nothing here changes what members or staff see.
 */
const log = createLogger("IdentityCheck");

const route = z.object({ route: z.enum(["manual", "automatic"]) });

/** Refused photo uploads while the automatic route is open, so its decline
 * and the one "ask a person" cannot be bypassed through the manual route. */
const AUTOMATIC_CHECK_MESSAGE =
  "Use the ID check on the Get verified page to verify your identity.";

export async function refuseWhileAutomaticCheckOpen(api: FoundationAuthenticatedApi) {
  const { data, error } = await api.rpc("get_identity_check_availability", {}, { get: false });
  const parsed = route.safeParse(data);
  if (error || !parsed.success) throw new FoundationVerificationError(503);
  if (parsed.data.route === "automatic")
    throw new FoundationVerificationError(409, AUTOMATIC_CHECK_MESSAGE);
}

const REASON_TEXT: Record<DiditUnavailableReason, { why: string; next: string }> = {
  no_credit: {
    why: "the Didit balance is used up",
    next: "Top up the Didit balance, then set the setting again in Verify accounts to end the pause.",
  },
  not_configured: {
    why: "Didit refused our settings (API key, its scopes or the workflow id)",
    next: "Check the DIDIT_API_KEY and DIDIT_WORKFLOW_ID Worker settings, then set the setting again in Verify accounts.",
  },
  outage: {
    why: "Didit did not answer",
    next: "Checks resume by themselves after 15 minutes. If this repeats, check Didit's status page.",
  },
};

/**
 * Marks a check that could not start and pauses automatic checks; the call
 * that starts a pause sends the one staff alert (to the support address).
 */
export async function pauseAutomaticChecks(
  service: FoundationServiceApi,
  checkId: string,
  reason: DiditUnavailableReason,
  send: typeof sendStaffOperationsEmail = sendStaffOperationsEmail
) {
  const reported = await service.rpc("report_identity_check_unavailable", {
    p_check: checkId,
    p_reason: reason,
  });
  if (reported.error) throw new Error("Identity check pause was not recorded");
  const pause = z
    .object({ paused_until: z.string(), newly_paused: z.boolean() })
    .parse(reported.data);
  log.warn("Automatic identity checks paused", {
    reason,
    pausedUntil: pause.paused_until,
    newlyPaused: pause.newly_paused,
  });
  if (!pause.newly_paused) return;
  const text = REASON_TEXT[reason];
  const intro = `Automatic ID checks are paused because ${text.why}. Members take their photos with the camera on the page and staff review them meanwhile.`;
  const sent = await send({
    to: [SUPPORT_CONTACT_EMAIL],
    idempotencyKey: `identity-check-paused/${pause.paused_until}`,
    subject: "VerifyMzansi: automatic ID checks paused",
    title: "Automatic ID checks paused",
    intro,
    sections: [{ rows: [["Paused until", pause.paused_until]] }],
    closing: text.next,
    reason: "The VerifyMzansi website sends this alert to the support address once per pause.",
    tone: "warning",
  }).catch(() => ({ success: false }));
  if (!sent.success) log.error("Identity check pause alert was not sent", { reason });
}

class IdentityCheckRefusal extends Error {
  override name = "IdentityCheckRefusal";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const startReasons = new Map<FoundationErrorReason, string>([
  ["identity_check_limit", "identity_check_limit"],
  ["identity_check_paused", "identity_check_paused"],
  ["identity_check_mode", "identity_check_mode"],
  ["identity_check_with_person", "identity_check_with_person"],
  ["verified_phone_required", "verified_phone_required"],
  ["legal_name_required", "legal_name_required"],
]);
const UNAVAILABLE =
  "The ID check isn't available right now. Take your photos on this page instead.";
const started = z.object({
  check_id: z.uuid(),
  session_id: z.uuid().nullable(),
  session_url: z.string().nullable(),
  created: z.boolean(),
});

async function startCheck(api: FoundationAuthenticatedApi, request: NextRequest) {
  const { data, error } = await api.rpc("start_my_identity_check", {}, { get: false });
  if (error) {
    if (error.code === "PT409")
      throw new IdentityCheckRefusal(
        409,
        lookupDatabaseReason(startReasons, error) ?? "identity_check_unavailable",
        UNAVAILABLE
      );
    throw error;
  }
  const check = started.parse(data);
  // An unfinished check carries on with its own session.
  if (check.session_url) return { checkId: check.check_id, url: check.session_url };
  const service = createFoundationServiceApi();
  const config = diditConfig();
  const unavailable = async (reason: DiditUnavailableReason) => {
    await pauseAutomaticChecks(service, check.check_id, reason);
    return new IdentityCheckRefusal(409, "identity_check_paused", UNAVAILABLE);
  };
  if (!config) throw await unavailable("not_configured");
  let session: Awaited<ReturnType<typeof createDiditSession>>;
  try {
    session = await createDiditSession(config, check.check_id);
  } catch (failure) {
    if (failure instanceof DiditError) throw await unavailable(failure.reason);
    throw failure;
  }
  const attached = await service.rpc("attach_identity_check_session", {
    p_check: check.check_id,
    p_session_id: session.sessionId,
    p_session_url: session.url,
    // Where the member started (compared with where the partner saw the
    // check): a keyed hash of the network and the kind of device only.
    p_network_hash: networkHash(getClientIp(request)),
    p_device_kind: deviceOfUserAgent(request.headers.get("user-agent")),
  });
  if (attached.error) throw new Error("Identity check session was not attached");
  return { checkId: check.check_id, url: session.url };
}

const askInput = z.strictObject({
  checkId: z.uuid(),
  reason: z.string().min(20).max(2000),
});

const refusal = (error: unknown): FoundationRefusal | null =>
  error instanceof IdentityCheckRefusal
    ? { status: error.status, error: error.message, reason: error.code, code: error.code }
    : null;

/** GET: where the member's ID check goes now, and their latest check. */
export function handleIdentityCheckAvailability(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "verification:status",
    mutate: false,
    unavailableMessage: "Verification is temporarily unavailable",
    signInMessage: "Sign in to manage verification",
    command: async (api) => {
      const { data, error } = await api.rpc("get_identity_check_availability", {}, { get: false });
      if (error) throw error;
      return route.passthrough().parse(data);
    },
    refusal,
  });
}

/** POST: starts (or resumes) the member's automatic ID check. */
export function handleIdentityCheckStart(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "verification:identity-check",
    mutate: true,
    unavailableMessage: "Verification is temporarily unavailable",
    signInMessage: "Sign in to manage verification",
    command: async (api, input) => {
      if (!z.strictObject({}).safeParse(input).success)
        throw new IdentityCheckRefusal(400, "invalid_request", "Reload the page and try again");
      return startCheck(api, request);
    },
    refusal,
  });
}

/** POST: asks a person to look again at a declined check (within 5 days). */
export function handleIdentityCheckAsk(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "verification:identity-check",
    mutate: true,
    unavailableMessage: "Verification is temporarily unavailable",
    signInMessage: "Sign in to manage verification",
    command: async (api, input) => {
      const parsed = askInput.safeParse(input);
      if (!parsed.success)
        throw new IdentityCheckRefusal(
          400,
          "invalid_request",
          "Tell us in at least 20 characters why a person should look again"
        );
      const { data, error } = await api.rpc(
        "ask_person_identity_check",
        { p_check: parsed.data.checkId, p_reason: parsed.data.reason },
        { get: false }
      );
      if (error?.code === "22023")
        throw new IdentityCheckRefusal(400, "invalid_request", "Check your note and try again");
      if (error?.code === "PT409")
        throw new IdentityCheckRefusal(
          409,
          "ask_person_unavailable",
          "A person can no longer be asked to look at this check"
        );
      if (error) throw error;
      return z.object({ check_id: z.uuid(), asked_at: z.string() }).parse(data);
    },
    refusal,
  });
}
