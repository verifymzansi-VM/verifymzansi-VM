import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import type { AppLogger } from "@/lib/utils/logger";

const DEFAULT_APP_URL = "https://verifymzansi.com";

export function resolveSafeBillingAppUrl(
  log: AppLogger
): { appUrl: string; response: null } | { appUrl: null; response: NextResponse } {
  const appUrl = env("NEXT_PUBLIC_APP_URL") || DEFAULT_APP_URL;

  try {
    const { hostname } = new URL(appUrl);
    const isAllowedHost =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith("verifymzansi.com");

    if (!isAllowedHost && process.env.NODE_ENV === "production") {
      log.error("NEXT_PUBLIC_APP_URL has unexpected hostname", { hostname });
      return {
        appUrl: null,
        response: NextResponse.json(
          { error: "Billing is not yet configured. Please try again later." },
          { status: 503 }
        ),
      };
    }
  } catch {
    log.error("NEXT_PUBLIC_APP_URL is not a valid URL", { appUrl });
    return {
      appUrl: null,
      response: NextResponse.json(
        { error: "Billing is not yet configured. Please try again later." },
        { status: 503 }
      ),
    };
  }

  return { appUrl, response: null };
}
