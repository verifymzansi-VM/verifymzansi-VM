import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import type { AppLogger } from "@/lib/utils/logger";

const DEFAULT_APP_URL = "https://verifymzansi.com";

export function resolveSafeBillingAppUrl(
  log: AppLogger
): { appUrl: string; response: null } | { appUrl: null; response: NextResponse } {
  const appUrl = env("NEXT_PUBLIC_APP_URL") || DEFAULT_APP_URL;

  try {
    const parsed = new URL(appUrl);
    const { hostname } = parsed;
    const isAllowedHost = hostname === "verifymzansi.com" || hostname.endsWith(".verifymzansi.com");
    const isProduction = process.env.NODE_ENV === "production";

    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/" ||
      (isProduction && (!isAllowedHost || parsed.protocol !== "https:" || parsed.port))
    ) {
      log.error("NEXT_PUBLIC_APP_URL is not an allowed billing origin");
      return {
        appUrl: null,
        response: NextResponse.json(
          { error: "Billing is not yet configured. Please try again later." },
          { status: 503 }
        ),
      };
    }
    return { appUrl: parsed.origin, response: null };
  } catch {
    log.error("NEXT_PUBLIC_APP_URL is not a valid URL");
    return {
      appUrl: null,
      response: NextResponse.json(
        { error: "Billing is not yet configured. Please try again later." },
        { status: 503 }
      ),
    };
  }
}
