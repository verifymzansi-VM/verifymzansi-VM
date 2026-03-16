import crypto from "crypto";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/utils/logger";
import { createAdminClient } from "@/lib/supabase/admin";

const log = createLogger("MockOzow");

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowedHosts = ["localhost", "127.0.0.1", "verifymzansi.com", "www.verifymzansi.com"];
    return allowedHosts.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
  } catch {
    return url.startsWith("/");
  }
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    log.error("Mock Ozow endpoint hit in production — blocked");
    return new NextResponse("Not found", { status: 404 });
  }

  if (process.env.ENABLE_MOCK_OZOW !== "true") {
    return new NextResponse("Not found", { status: 404 });
  }

  log.warn("Mock Ozow payment flow activated — this must not happen in production");

  const url = new URL(request.url);
  const paymentId = url.searchParams.get("paymentId");
  const amount = url.searchParams.get("amount");
  const returnUrl = url.searchParams.get("returnUrl");

  if (paymentId) {
    // Guard: verify the payment exists and was created in the mock flow
    // to prevent completing real payments via the mock endpoint
    try {
      const supabase = createAdminClient();
      const { data: payment } = await supabase
        .from("payments")
        .select("id, provider")
        .eq("id", paymentId)
        .eq("provider", "mock-ozow")
        .maybeSingle();

      if (!payment) {
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
        transactionId: `mock-${paymentId}`,
        merchantReference: paymentId,
        amount,
        currencyCode: "ZAR",
      },
    };
    const body = JSON.stringify(payload);
    const webhookUrl = new URL("/api/webhooks/ozow", request.url).toString();
    const secret = process.env.OZOW_WEBHOOK_SECRET;
    const signature = secret
      ? crypto.createHmac("sha256", secret).update(body).digest("hex")
      : undefined;

    await fetch(webhookUrl, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "X-Ozow-Signature": signature } : {}),
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
