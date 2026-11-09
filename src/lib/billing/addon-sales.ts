import { NextResponse } from "next/server";
import { createLogger } from "@/lib/utils/logger";

/**
 * Whether paid add-ons (Urgent, Boost, Featured) are on sale at all.
 *
 * Add-on sales stay paused until visitors can see what an add-on delivers.
 * While paused, every server path that could start an add-on purchase refuses
 * before it creates a payment or contacts the payment provider; the restored
 * buttons stay as they are and show the refusal through their usual message.
 *
 * Only the exact value "true" opens sales. A missing, empty or any other value
 * ("TRUE", "1", "yes", " true") keeps them paused, so a typo fails closed.
 * Plans are not add-ons and are never affected by this switch. Payments that
 * already exist are still settled, reconciled or cancelled as before.
 */
export const ADDON_SALES_SWITCH = "ADDON_SALES_ENABLED";

export const ADDON_SALES_PAUSED_CODE = "addon_sales_paused";

export const ADDON_SALES_PAUSED_MESSAGE = "Add-ons open soon. You have not been charged.";

const log = createLogger("AddonSales");

export function areAddonSalesOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env[ADDON_SALES_SWITCH] === "true";
}

/**
 * The reply every add-on checkout entry point gives while sales are paused.
 * `entry` names the entry point (fixed by the code, never request data), so
 * the log line carries no personal data.
 */
export function addonSalesPausedResponse(entry: string): NextResponse {
  log.info("Paid add-on checkout refused while add-on sales are paused", { entry });
  return NextResponse.json(
    { error: ADDON_SALES_PAUSED_MESSAGE, code: ADDON_SALES_PAUSED_CODE },
    { status: 403, headers: { "Cache-Control": "private, no-store" } }
  );
}
