import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";

import { env } from "@/lib/config/env";
import { createHostedCheckout } from "@/lib/payments/checkout";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/services/audit";
import { getActivePlanTierForArea } from "@/lib/services/plan-tier";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { parseAndValidateRouteParams } from "@/lib/utils/api";
import { createLogger, type AppLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import type { MarketplaceArea } from "@/types/enums";

type AllowedResult = {
  allowed: boolean;
  reason?: string;
};

type Actor = {
  id: string;
};

type RouteContext<Params extends Record<string, unknown>> = {
  request: NextRequest;
  params: Params;
  user: Actor;
  supabase: Awaited<ReturnType<typeof createClient>>;
  admin: ReturnType<typeof createAdminClient>;
  log: AppLogger;
};

type AddonEntity = {
  id: string;
  status: string;
} & Record<string, string | null | undefined>;

type PendingPaymentMatch = Record<string, string>;

type AuditPayload = {
  targetType: "listing" | "business" | "promotion";
  targetId: string;
  area?: "MZANSI_MARKET" | "MALL_SHOPS" | "BUSINESS_ADS" | "PROMOTIONS_EVENTS";
};

type CheckoutPayload = {
  area: MarketplaceArea;
  itemName: string;
  providerData: Record<string, string | number>;
};

type CoreConfig<
  Params extends Record<string, string>,
  Entity extends AddonEntity,
  PaymentType extends string,
> = {
  loggerName: string;
  paramsSchema: ZodType<Params>;
  validationErrorMessage: string;
  activeUntilField: "featured_until" | "boost_until" | "urgent_until";
  activeVerb: string;
  alreadyActiveMessage: string;
  pendingPaymentMessage: string;
  paymentType: PaymentType;
  durationDays: number;
  itemDescription: string;
  amountCents: number;
  liveOnlyNoun: string;
  auditAction: string;
  auditDurationKey: string;
  failureMessage: string;
  getEntityId: (params: Params) => string;
  enforceRateLimit: (
    context: RouteContext<Params>
  ) => Promise<NextResponse | null> | NextResponse | null;
  ensureAccountProfile: (
    context: RouteContext<Params>
  ) => Promise<NextResponse | null> | NextResponse | null;
  findEntity: (context: RouteContext<Params>) => Promise<Entity | null>;
  getNotFoundMessage: string;
  verifyOwnership: (entity: Entity, userId: string) => NextResponse | null;
  resolveArea: (entity: Entity) => MarketplaceArea;
  entitlementCheck: (tier: string | null, area: MarketplaceArea) => AllowedResult;
  buildPendingPaymentMatch: (entityId: string) => PendingPaymentMatch;
  buildCheckoutPayload: (entity: Entity, entityId: string) => CheckoutPayload;
  buildAuditPayload: (entityId: string, area: MarketplaceArea) => AuditPayload;
};

export function createAddonCheckoutRouteCore<
  Params extends Record<string, string>,
  Entity extends AddonEntity,
  PaymentType extends string,
>(config: CoreConfig<Params, Entity, PaymentType>) {
  return async function POST(request: NextRequest, { params }: { params: Promise<Params> }) {
    const supabase = await createClient();
    const admin = createAdminClient();
    const log = createLogger(config.loggerName);

    try {
      const originBlock = enforceSameOriginMutation(request, log);
      if (originBlock) return originBlock;

      const csrfBlock = enforceCsrfToken(request, log);
      if (csrfBlock) return csrfBlock;

      const parsedParams = parseAndValidateRouteParams(await params, config.paramsSchema, {
        validationErrorMessage: config.validationErrorMessage,
        includeValidationDetails: false,
      });
      if (!parsedParams.success) {
        return parsedParams.response;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const routeContext: RouteContext<Params> = {
        request,
        params: parsedParams.data,
        user,
        supabase,
        admin,
        log,
      };

      const rateLimitResponse = await config.enforceRateLimit(routeContext);
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      const profileResponse = await config.ensureAccountProfile(routeContext);
      if (profileResponse) {
        return profileResponse;
      }

      const entity = await config.findEntity(routeContext);
      if (!entity) {
        return NextResponse.json({ error: config.getNotFoundMessage }, { status: 404 });
      }

      const ownershipError = config.verifyOwnership(entity, user.id);
      if (ownershipError) {
        return ownershipError;
      }

      if (entity.status !== "live") {
        return NextResponse.json(
          { error: `Only live ${config.liveOnlyNoun} can be ${config.activeVerb}` },
          { status: 400 }
        );
      }

      const activeUntil = entity[config.activeUntilField];
      if (typeof activeUntil === "string" && new Date(activeUntil) > new Date()) {
        return NextResponse.json({ error: config.alreadyActiveMessage }, { status: 400 });
      }

      const entityId = config.getEntityId(parsedParams.data);
      const { data: pendingPmt, error: pendingError } = await admin
        .from("payments")
        .select("id")
        .eq("user_id", user.id)
        .in("status", ["pending", "processing"])
        .contains("provider_data", {
          type: config.paymentType,
          ...config.buildPendingPaymentMatch(entityId),
        })
        .maybeSingle();

      if (pendingError) {
        log.error("Failed to check pending payments", {
          userId: user.id,
          error: pendingError.message,
        });
        return NextResponse.json({ error: "Unable to verify payment status" }, { status: 503 });
      }

      if (pendingPmt) {
        return NextResponse.json({ error: config.pendingPaymentMessage }, { status: 409 });
      }

      const checkoutPayload = config.buildCheckoutPayload(entity, entityId);
      const tier = await getActivePlanTierForArea(user.id, checkoutPayload.area);
      const addonCheck = config.entitlementCheck(tier, checkoutPayload.area);

      if (!addonCheck.allowed) {
        return NextResponse.json({ error: addonCheck.reason }, { status: 403 });
      }

      const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.com";
      const { paymentId, checkoutUrl } = await createHostedCheckout({
        admin: admin as never,
        userId: user.id,
        area: checkoutPayload.area,
        amountCents: config.amountCents,
        itemName: checkoutPayload.itemName.slice(0, 100),
        itemDescription: config.itemDescription,
        returnUrl: `${appUrl}/billing/success?payment=__PAYMENT_ID__`,
        cancelUrl: `${appUrl}/billing/cancel?payment=__PAYMENT_ID__`,
        providerData: {
          type: config.paymentType,
          ...checkoutPayload.providerData,
        },
      });

      try {
        const auditPayload = config.buildAuditPayload(entityId, checkoutPayload.area);
        await logAuditEvent({
          actorId: user.id,
          actorRole: "member",
          action: config.auditAction,
          targetType: auditPayload.targetType,
          targetId: auditPayload.targetId,
          ...(auditPayload.area ? { area: auditPayload.area } : {}),
          metadata: {
            paymentId,
            amount: config.amountCents / 100,
            [config.auditDurationKey]: config.durationDays,
            status: "checkout_initiated",
          },
        });
      } catch (auditErr) {
        log.error("Audit log failed (non-fatal)", {
          error: auditErr instanceof Error ? auditErr.message : "Unknown",
          paymentId,
        });
      }

      return NextResponse.json({
        success: true,
        checkoutUrl,
        paymentId,
      });
    } catch (err) {
      log.error("Unexpected error", {
        error: err instanceof Error ? err.message : "Unknown error",
      });
      return NextResponse.json({ error: config.failureMessage }, { status: 500 });
    }
  };
}
