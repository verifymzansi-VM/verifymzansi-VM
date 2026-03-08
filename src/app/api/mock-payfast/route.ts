import { NextResponse } from "next/server";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("MockPayFast");

/** Validate that a URL is safe to redirect to (same-origin or localhost only) */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowedHosts = [
      "localhost",
      "127.0.0.1",
      "verifymzansi.com",
      "www.verifymzansi.com",
      "verifymzansi.com",
      "www.verifymzansi.com",
    ];
    return allowedHosts.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`));
  } catch {
    return url.startsWith("/"); // Allow relative paths
  }
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.ENABLE_MOCK_PAYFAST !== "true") {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(req.url);
  const m_payment_id = url.searchParams.get("m_payment_id");
  const amount = url.searchParams.get("amount");
  const notify_url = url.searchParams.get("notify_url");
  const return_url = url.searchParams.get("return_url");

  // Fire webhook in the background to simulate PayFast ITN
  // Only allow notify_url pointing to the same origin to prevent SSRF
  const reqOrigin = new URL(req.url).origin;
  const isNotifyUrlSafe = (() => {
    if (!notify_url) return false;
    try {
      return new URL(notify_url).origin === reqOrigin;
    } catch {
      return false;
    }
  })();

  if (notify_url && isNotifyUrlSafe) {
    const data = new URLSearchParams({
      m_payment_id: m_payment_id || "",
      pf_payment_id: "mock_" + Date.now(),
      payment_status: "COMPLETE",
      item_name: url.searchParams.get("item_name") || "",
      amount_gross: amount || "0.00",
      amount_fee: "0.00",
      amount_net: amount || "0.00",
      custom_str1: "",
      custom_int1: "",
      signature: "dev_bypass_signature",
    });

    // Fire and forget
    fetch(notify_url, {
      method: "POST",
      body: data,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch((e: unknown) =>
      log.error("ITN notify failed", { error: e instanceof Error ? e.message : "unknown error" })
    );
  }

  // Validate return_url to prevent open redirect
  const safeReturnUrl = return_url && isSafeUrl(return_url) ? return_url : "/";
  return NextResponse.redirect(new URL(safeReturnUrl, req.url));
}
