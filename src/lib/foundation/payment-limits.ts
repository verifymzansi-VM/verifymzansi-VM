import "server-only";
import { readFoundationPaymentLimits } from "./billing-catalogue";
import { foundationServerPublicApi } from "./server-public";
import { createLogger } from "@/lib/utils/logger";
import { logDegradedRead } from "@/lib/utils/request-failure";

const log = createLogger("PaymentLimits");

/**
 * The most one online (Ozow) payment may be, in cents, read from the database
 * (public, like the price catalogue, so it works for signed-out visitors).
 * Null when it cannot be read: pages then offer both ways to pay and the
 * database still refuses a total above it.
 */
export async function readOnlinePaymentMaxCents(): Promise<number | null> {
  try {
    return (await readFoundationPaymentLimits(foundationServerPublicApi())).onlineMaxCents;
  } catch (error) {
    logDegradedRead(log, "Online payment limit unavailable", error);
    return null;
  }
}
