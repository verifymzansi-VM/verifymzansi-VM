import crypto from "crypto";
import { Webhook } from "svix";
import { z } from "zod";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/utils/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { parseAndValidateSearchParams } from "@/lib/utils/api";
import {
  createNonNegativeNumberSchema,
  optionalTrimmedStringSchema,
  optionalUuidSchema,
} from "@/lib/validations/shared";

const log = createLogger("MockOzow");

const mockOzowQuerySchema = z.object({
  paymentId: optionalUuidSchema,
  amount: createNonNegativeNumberSchema("amount"),
  returnUrl: optionalTrimmedStringSchema.refine(
    (value) => value === undefined || isSafeUrl(value),
    "returnUrl is invalid"
  ),
});

function isPrivateIp(hostname: string): boolean {
  if (hostname === "[::1]") return true;
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowedHosts = ["localhost", "127.0.0.1", "verifymzansi.com", "www.verifymzansi.com"];
    if (allowedHosts.includes(parsed.hostname)) {
      return true;
    }
    if (isPrivateIp(parsed.hostname)) return false;
    return allowedHosts.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
  } catch {
    // Only allow relative paths (starting with "/" but not "//")
    return url.startsWith("/") && !url.startsWith("//");
  }
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" && !isPlaywrightTestMode()) {
    log.error("Mock Ozow endpoint hit in production — blocked");
    return new NextResponse("Not found", { status: 404 });
  }

  if (process.env.ENABLE_MOCK_OZOW !== "true") {
    return new NextResponse("Not found", { status: 404 });
  }

  log.warn("Mock Ozow payment flow activated — this must not happen in production");

  const url = new URL(request.url);
  const parsedQuery = parseAndValidateSearchParams(url.searchParams, mockOzowQuerySchema, {
    validationErrorMessage: "Invalid mock payment query",
  });

  if (!parsedQuery.success) {
    return parsedQuery.response;
  }

  const { paymentId, amount, returnUrl } = parsedQuery.data;

  if (paymentId) {
    // Guard: verify the payment exists and was created in the mock flow
    // to prevent completing real payments via the mock endpoint
    try {
      const supabase = createAdminClient();
      const { data: payment } = await supabase
        .from("payments")
        .select("id, provider, provider_data")
        .eq("id", paymentId)
        .maybeSingle();

      const providerData =
        payment?.provider_data && typeof payment.provider_data === "object"
          ? payment.provider_data
          : null;
      const isMockFlow =
        payment?.provider === "mock-ozow" ||
        providerData?.mock_flow === true ||
        providerData?.checkout?.mockFlow === true;

      if (!payment || !isMockFlow) {
        log.warn("Mock Ozow attempted on non-mock payment", { paymentId });
        return new NextResponse("Payment not found or not a mock payment", { status: 404 });
      }
    } catch (error) {
      log.error("Mock Ozow payment verification failed", {
        paymentId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return new NextResponse("Internal error", { status: 500 });
    }

    const payload = {
      eventType: "transaction.complete",
      data: {
        id: `mock-${paymentId}`,
        merchantReference: paymentId,
        amount:
          typeof amount === "number"
            ? {
                currency: "ZAR",
                value: amount,
              }
            : undefined,
        status: "successful",
      },
    };
    const body = JSON.stringify(payload);
    const webhookUrl = new URL("/api/webhooks/ozow", request.url).toString();
    const secret = process.env.OZOW_WEBHOOK_SECRET;
    const signatureTimestamp = new Date();
    const signatureId = crypto.randomUUID();
    const signature = secret
      ? new Webhook(secret).sign(signatureId, signatureTimestamp, body)
      : undefined;

    await fetch(webhookUrl, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        ...(signature
          ? {
              "svix-id": signatureId,
              "svix-timestamp": Math.floor(signatureTimestamp.getTime() / 1000).toString(),
              "svix-signature": signature,
            }
          : {}),
      },
    }).catch((error: unknown) => {
      log.error("Mock Ozow webhook failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
  }

  const safeReturnUrl = returnUrl && isSafeUrl(returnUrl) ? returnUrl : "/";
  return NextResponse.redirect(new URL(safeReturnUrl, request.url));
}
