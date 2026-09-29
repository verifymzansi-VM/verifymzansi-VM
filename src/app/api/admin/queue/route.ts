import { NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import {
  claimNextItems,
  claimRefusalResponse,
  reassignClaim,
  releaseClaims,
  renewClaims,
} from "@/lib/services/queue-claims";

const log = createLogger("QueueClaimsRoute");

const itemType = z.enum([
  "report",
  "verification_step",
  "listing",
  "business",
  "promotion",
  "content_edit",
]);

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("claim"),
    queue: z.enum(["reports", "kyc", "content"]),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  z.object({ action: z.literal("renew") }),
  z.object({
    action: z.literal("release"),
    itemType: itemType.optional(),
    itemId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("reassign"),
    itemType,
    itemId: z.string().uuid(),
    /** null frees the item for anyone to claim. */
    to: z.string().uuid().nullable(),
    reason: z.string().trim().min(5).max(500),
  }),
]);

/**
 * POST /api/admin/queue
 *
 * claim the next items from a queue, renew your claims, release them, or (as
 * a governor or admin) free or reassign someone else's claim.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      capability: "queue:view",
      rateLimitAction: "admin:queue",
    });
    if (!guard.success) return guard.response;

    const body = await parseAndValidateJsonRequest(request, schema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;
    const input = body.data;
    const actor = guard.user.id;

    if (input.action === "claim") {
      const result = await claimNextItems(actor, input.queue, input.limit);
      if (!result.ok) return claimRefusalResponse(result.error);
      return NextResponse.json({
        claimed: result.items.length,
        items: result.items,
        message:
          result.items.length === 0
            ? "Nothing to claim: the queue is empty or you already hold 20 items."
            : `You have ${result.items.length} new ${result.items.length === 1 ? "item" : "items"} for 15 minutes.`,
      });
    }
    if (input.action === "renew") {
      return NextResponse.json({ renewed: await renewClaims(actor) });
    }
    if (input.action === "release") {
      const item =
        input.itemType && input.itemId ? { type: input.itemType, id: input.itemId } : undefined;
      return NextResponse.json({ released: await releaseClaims(actor, item) });
    }

    const result = await reassignClaim(
      actor,
      { type: input.itemType, id: input.itemId },
      input.to,
      input.reason
    );
    if (!result.ok) return claimRefusalResponse(result.error);
    return NextResponse.json({ status: result.status });
  } catch (err) {
    logApiError(log, "Queue action failed", err);
    return internalApiError();
  }
}
