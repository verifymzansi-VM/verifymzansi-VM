import { z } from "zod";
import { useAuthStore } from "@/stores/auth-store";
const checkout = z.object({ account_id: z.uuid(), paymentId: z.uuid(), checkoutUrl: z.url() });
/** An outstanding checkout must not redirect a newly signed-in account to a
 * previous account's payment. Recheck the verified response and current actor. */
export function navigateToFoundationCheckout(
  input: unknown,
  accountId: string,
  navigate = (url: string) => window.location.assign(url)
) {
  const result = checkout.safeParse(input);
  if (
    !result.success ||
    result.data.account_id !== accountId ||
    useAuthStore.getState().user?.id !== accountId
  )
    throw new Error("Your account changed. Refresh Billing before starting checkout.");
  const url = new URL(result.data.checkoutUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === "ozow.com" || url.hostname.endsWith(".ozow.com"))
  )
    throw new Error("The payment destination could not be verified");
  navigate(url.href);
}
