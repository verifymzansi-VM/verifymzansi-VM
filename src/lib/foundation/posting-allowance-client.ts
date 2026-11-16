"use client";
import { getRestoredFoundationBrowserClient as createClient } from "@/lib/foundation/restored-browser-client";
import type { MarketplaceArea } from "@/types/enums";
import { postingAllowanceSchema } from "./posting-allowance";
import { parseFoundationBillingCatalogue } from "./billing-catalogue";
/** Every request is self-only and uncached across accounts. Check the identity
 * again after the read before allowing this response to update a form. */
export async function fetchPostingAllowance(area: MarketplaceArea) {
  const client = createClient();
  const before = await client.auth.getUser();
  if (before.error || !before.data.user) throw new Error("not_authenticated");
  const response = await fetch(`/api/billing/allowance?area=${encodeURIComponent(area)}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (response.status === 401) throw new Error("not_authenticated");
  if (!response.ok) throw new Error("failed");
  const body = await response.json();
  const result = postingAllowanceSchema.parse(body.posting);
  const catalogue = parseFoundationBillingCatalogue(body.catalogue);
  const after = await client.auth.getUser();
  if (
    after.error ||
    after.data.user?.id !== before.data.user.id ||
    result.account_id !== before.data.user.id
  )
    throw new Error("not_authenticated");
  return { ...result, catalogue };
}
