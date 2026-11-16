import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { badRequestResponse } from "@/lib/utils/api";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/utils/request-body";
import { handleFoundationOwnerRoute, type FoundationRefusal } from "@/lib/foundation/owner-route";

const logger = createLogger("Drafts");

const VALID_FLOWS = new Set(["listing", "promotion", "business"]);

/** Maximum draft request body size (64 KiB). */
const MAX_DRAFT_BODY_BYTES = 64 * 1024;
const draftData = z.record(z.string(), z.json());
const readResult = z.strictObject({
  draft: z
    .strictObject({
      step: z.number().int().nonnegative(),
      data: draftData,
      saved_at: z.iso.datetime({ offset: true }),
    })
    .nullable(),
});
const writeResult = z.strictObject({ ok: z.literal(true) });
class DraftRefusal extends Error {
  override name = "DraftRefusal";
  constructor(readonly response: FoundationRefusal) {
    super(response.error);
  }
}

function handleRestoredDraft(
  request: NextRequest,
  flow: string,
  operation: { action: "read" | "discard" } | { action: "save"; step: number; data: unknown }
) {
  return handleFoundationOwnerRoute({
    request,
    log: logger,
    action: "drafts:sync",
    // Both HTTP mutations already passed the origin and CSRF guards below.
    // DELETE has no request body; PUT parsed the bounded body before dispatch.
    mutate: false,
    signInMessage: "Sign in to manage your draft",
    unavailableMessage: "Draft synchronization is temporarily unavailable",
    command: async (api) => {
      const expected = request.headers.get("x-draft-account");
      const account = expected === null ? undefined : z.uuid().safeParse(expected).data;
      if (expected !== null && !account)
        throw new DraftRefusal({
          status: 400,
          error: "Check the draft details and try again.",
          reason: "draft_invalid",
        });
      const { data, error } = await api.rpc(
        "frontend_form_draft",
        {
          p_flow: flow,
          p_action: operation.action,
          ...(account ? { p_expected_account: account } : {}),
          ...(operation.action === "save"
            ? {
                p_step: operation.step,
                p_data: draftData.parse(operation.data),
              }
            : {}),
        },
        { get: false }
      );
      if (error?.code === "42501")
        throw new DraftRefusal({
          status: 403,
          error: "This draft is unavailable for the current account.",
          reason: "draft_access",
        });
      if (error?.code === "22023")
        throw new DraftRefusal({
          status: 400,
          error: "Check the draft details and try again.",
          reason: "draft_invalid",
        });
      if (error) throw new Error("Draft request unavailable");
      return (operation.action === "read" ? readResult : writeResult).parse(data);
    },
    refusal: (error) => (error instanceof DraftRefusal ? error.response : null),
  });
}

/**
 * GET /api/drafts?flow=listing
 * Load the authenticated user's draft for the given flow.
 */
export async function GET(request: NextRequest) {
  const flow = request.nextUrl.searchParams.get("flow");
  if (!flow || !VALID_FLOWS.has(flow)) {
    return badRequestResponse("Invalid flow");
  }
  return handleRestoredDraft(request, flow, { action: "read" });
}

/**
 * PUT /api/drafts
 * Upsert the authenticated user's draft for a flow.
 * Body: { flow, step, data }
 */
export async function PUT(request: NextRequest) {
  const originBlock = enforceSameOriginMutation(request, logger);
  if (originBlock) return originBlock;
  const csrfBlock = enforceCsrfToken(request, logger);
  if (csrfBlock) return csrfBlock;

  let body: unknown;
  try {
    body = JSON.parse(await readBoundedRequestText(request, MAX_DRAFT_BODY_BYTES));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { flow, step, data } = body as Record<string, unknown>;

  if (typeof flow !== "string" || !VALID_FLOWS.has(flow)) {
    return NextResponse.json({ error: "Invalid flow" }, { status: 400 });
  }
  if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step > 2_147_483_647) {
    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return badRequestResponse("Invalid data");
  }
  return handleRestoredDraft(request, flow, { action: "save", step, data });
}

/**
 * DELETE /api/drafts?flow=listing
 * Remove the authenticated user's draft for the given flow.
 */
export async function DELETE(request: NextRequest) {
  const originBlock = enforceSameOriginMutation(request, logger);
  if (originBlock) return originBlock;
  const csrfBlock = enforceCsrfToken(request, logger);
  if (csrfBlock) return csrfBlock;

  const flow = request.nextUrl.searchParams.get("flow");
  if (!flow || !VALID_FLOWS.has(flow)) {
    return badRequestResponse("Invalid flow");
  }
  return handleRestoredDraft(request, flow, { action: "discard" });
}
