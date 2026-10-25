import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "./request-route";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { FoundationSessionError } from "./request-api";
import { enforceMutationRequest } from "../utils/mutation-guard";
import { parseJsonRequest } from "../utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "../utils/rate-limit";
import { createLogger } from "../utils/logger";
import { createFoundationPublicApi } from "./public-api";
import { readFoundationBillingCatalogue } from "./billing-catalogue";
import {
  cancelFoundationPendingPayment,
  FoundationBillingError,
  manageFoundationPlanMember,
  readFoundationBilling,
  readFoundationPayment,
  reconcileFoundationPayment,
  startFoundationCheckout,
} from "./billing-runtime";

type Operation =
  | "checkout"
  | "payment-status"
  | "cancel-pending"
  | "overview"
  | "manage-member"
  | "retired"
  | "allowance";
const noStore = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" };
const log = createLogger("FoundationBilling");
const areaMap = {
  MZANSI_MARKET: "market",
  MZANSI_BUSINESS: "business",
  PROMOTIONS_EVENTS: "tourism_events",
} as const;

/** This bridge preserves the current website URLs while selecting the new
 * session and SQL command model before any legacy table factory is created. */
export async function handleFoundationBillingRoute(
  request: NextRequest,
  operation: Operation,
  addon?: { postId: string; kind: "boost" | "featured" | "urgent"; days: number }
) {
  const mutate = !["payment-status", "overview", "allowance"].includes(operation);
  if (mutate) {
    const blocked = enforceMutationRequest(request, log);
    if (blocked) return blocked;
  }
  let context: ReturnType<typeof createFoundationRouteContext> | undefined;
  try {
    const connection = readFoundationRuntimeConnection();
    context = createFoundationRouteContext(connection, request);
    const caller = await context.authenticateCaller();
    const limit = await checkRateLimit({
      key: `${caller.accountId}:${getClientRateLimitIdentity(request).key}`,
      action: mutate ? "billing:checkout" : "billing:read",
      degradedMode: "block",
    });
    if (limit.limited)
      return context.respond(
        NextResponse.json(
          { error: limit.degraded ? "Billing protection is unavailable" : "Too many requests" },
          {
            status: limit.degraded ? 503 : 429,
            headers: { "Retry-After": String(limit.retryAfter ?? 60) },
          }
        )
      );
    if (operation === "retired")
      return context.respond(
        NextResponse.json(
          {
            error:
              "Plans are prepaid for a fixed period and do not renew automatically. Buy another slot from Billing when you need it.",
            code: "LEGACY_PLAN_ROUTE_RETIRED",
          },
          { status: 410 }
        )
      );
    if (operation === "overview")
      return context.respond(
        NextResponse.json({
          account_id: caller.accountId,
          data: await readFoundationBilling(caller.api),
        })
      );
    if (operation === "allowance") {
      const area = z
        .enum(["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"])
        .parse(request.nextUrl.searchParams.get("area"));
      const billing = await readFoundationBilling(caller.api);
      const entries = billing.entitlements.filter(
        (entry) => entry.area === null || entry.area === areaMap[area]
      );
      const capacity = entries.reduce((sum, entry) => sum + entry.slot_capacity, 0);
      const used = entries.reduce((sum, entry) => sum + entry.used, 0);
      return context.respond(
        NextResponse.json({
          capacity,
          activeUsage: used,
          used,
          hasPaidPlan: entries.some((entry) => entry.source === "retail_paid"),
          maxPhotos: Math.max(0, ...entries.map((entry) => entry.max_photos)),
          maxVideos: Math.max(0, ...entries.map((entry) => entry.max_videos)),
          expiresAt:
            entries
              .map((entry) => entry.ends_at)
              .sort()
              .at(-1) ?? null,
          sources: [...new Set(entries.map((entry) => entry.source))],
          boostAllowed: entries.some((entry) => entry.addon_capabilities.includes("boost")),
        })
      );
    }
    if (operation === "payment-status") {
      const id = request.nextUrl.searchParams.get("payment");
      if (!id)
        return context.respond(
          NextResponse.json({ status: "missing", terminal: true, expired: false })
        );
      z.uuid().parse(id);
      let pay = await readFoundationPayment(caller.api, id);
      if (!pay)
        return context.respond(
          NextResponse.json({ status: "missing", terminal: true, expired: false })
        );
      if (["pending", "failed", "expired"].includes(pay.status) && pay.provider_request_id) {
        try {
          await reconcileFoundationPayment(pay.id);
          pay = (await readFoundationPayment(caller.api, id)) ?? pay;
        } catch {
          /* Preserve the stored state during a provider outage. */
        }
      }
      const status = ["cancelled", "refunded", "chargeback"].includes(pay.status)
        ? "failed"
        : pay.status;
      return context.respond(
        NextResponse.json({ status, terminal: status !== "pending", expired: status === "expired" })
      );
    }
    const input = addon ? null : await parseJsonRequest(request, { maxBytes: 4096 });
    if (operation === "cancel-pending") {
      const value = z.strictObject({ paymentId: z.uuid() }).parse(input);
      return context.respond(
        NextResponse.json(await cancelFoundationPendingPayment(caller.api, value.paymentId))
      );
    }
    if (operation === "manage-member")
      return context.respond(
        NextResponse.json(await manageFoundationPlanMember(caller.api, input))
      );
    const catalogue = await readFoundationBillingCatalogue(createFoundationPublicApi(connection));
    let productId: string;
    let postId: string | null = null;
    if (addon) {
      postId = z.uuid().parse(addon.postId);
      const product = catalogue.addons.find(
        (entry) => entry.kind === addon.kind && entry.days === addon.days
      );
      if (!product) throw new FoundationBillingError(400, "This add-on is not available");
      productId = product.id;
    } else {
      const value = z
        .strictObject({
          planId: z.uuid(),
          area: z.enum(["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"]).optional(),
        })
        .parse(input);
      const product = catalogue.plans.find((entry) => entry.id === value.planId);
      if (!product || (value.area && product.area !== null && product.area !== areaMap[value.area]))
        throw new FoundationBillingError(400, "This plan is not available in the selected section");
      productId = product.id;
    }
    const result = await startFoundationCheckout(
      caller.api,
      caller.accountId,
      productId,
      postId,
      process.env.NEXT_PUBLIC_APP_URL ?? "https://verifymzansi.com"
    );
    return context.respond(NextResponse.json({ ...result, account_id: caller.accountId }));
  } catch (error) {
    const status =
      error instanceof FoundationBillingError || error instanceof FoundationSessionError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503;
    const message =
      error instanceof FoundationBillingError
        ? error.message
        : status === 401
          ? "Sign in to continue"
          : status === 400
            ? "Check the billing details"
            : "Billing is temporarily unavailable";
    const response = NextResponse.json({ error: message }, { status, headers: noStore });
    return context ? context.respond(response) : response;
  }
}
