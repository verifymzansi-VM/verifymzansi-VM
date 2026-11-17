import "server-only";

import { z } from "zod";
import { createFoundationServiceApi, type FoundationServiceApi } from "./service-api";

const plan = z.strictObject({
  id: z.uuid(),
  term_days: z.union([z.literal(30), z.literal(90), z.literal(180)]),
  price_cents_per_slot: z.string().regex(/^[1-9][0-9]{2,7}$/),
  label: z.string().min(1).max(120),
});
const offer = z.strictObject({
  on_sale: z.boolean(),
  min_slots: z.number().int().positive(),
  max_online_slots: z.number().int().positive(),
  max_slots: z.number().int().positive(),
  online_limit_cents: z.string().regex(/^[1-9][0-9]{2,9}$/),
  posts_per_slot_per_30_days: z.number().int().positive(),
  plans: z.array(plan).max(3),
});
export type FoundationSlotPackageOffer = z.infer<typeof offer>;

/** Multi-listing packages on offer (api.get_slot_package_offer, a trusted
 * server read: browsers and the publishable key get nothing): whether they are
 * on sale (the owner's switch, off until business tools P5-P7 pass) and the
 * terms, listed only while on sale. Every page that sells or describes
 * packages is hidden while it is off. */
export async function readFoundationSlotPackageOffer(
  api: FoundationServiceApi
): Promise<FoundationSlotPackageOffer> {
  const { data, error } = await api.rpc("get_slot_package_offer");
  if (error) throw new Error("Foundation package offer unavailable");
  const parsed = offer.safeParse(data);
  if (!parsed.success) throw new Error("Invalid foundation package offer");
  return parsed.data;
}

/** The offer, or "off" when it cannot be read: a page never sells packages
 * it cannot confirm are on sale. */
export async function readPackagesOnSale(
  api?: FoundationServiceApi
): Promise<FoundationSlotPackageOffer | null> {
  try {
    const value = await readFoundationSlotPackageOffer(api ?? createFoundationServiceApi());
    return value.on_sale && value.plans.length > 0 ? value : null;
  } catch {
    return null;
  }
}
