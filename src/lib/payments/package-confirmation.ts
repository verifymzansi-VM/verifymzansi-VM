import "server-only";

import { readFoundationServerSession } from "@/lib/foundation/server-session";
import {
  readFoundationMySlotPackage,
  readFoundationMySlots,
  readFoundationPayment,
} from "@/lib/foundation/billing-runtime";
import { readPackagesOnSale } from "@/lib/foundation/slot-package-offer";

/** What the "Your package is active" confirmation shows (roadmap P4a). */
export interface PackageConfirmation {
  slots: number;
  startsAt: string;
  endsAt: string;
  /** New posts allowed per 30 days, over the whole package. */
  newPostsLimit: number;
  paidCents: number;
  /** The member also holds Individual slots, which keep running beside it. */
  individualSlots: boolean;
}

/**
 * Whether the member's payment bought a Multi-listing package (its term is
 * one of the package terms on sale) and, once it is paid and delivered, the
 * package it opened. `packagePayment` false, or any read failing, leaves the
 * page with the general confirmation.
 */
export async function readPackageConfirmation(paymentId?: string): Promise<{
  packagePayment: boolean;
  details: PackageConfirmation | null;
}> {
  const none = { packagePayment: false, details: null };
  if (!paymentId || !/^[a-f0-9-]{36}$/i.test(paymentId)) return none;
  try {
    const offer = await readPackagesOnSale();
    if (!offer) return none;
    const { api } = await readFoundationServerSession();
    const payment = await readFoundationPayment(api, paymentId);
    if (!payment || !offer.plans.some((plan) => plan.id === payment.product_id)) return none;
    if (payment.status !== "complete" || payment.fulfillment_status !== "fulfilled")
      return { packagePayment: true, details: null };
    const [mine, slots] = await Promise.all([
      readFoundationMySlotPackage(api),
      readFoundationMySlots(api).catch(() => null),
    ]);
    const held = mine.package;
    if (!held || held.state !== "active") return { packagePayment: true, details: null };
    return {
      packagePayment: true,
      details: {
        slots: held.places,
        startsAt: held.starts_at,
        endsAt: held.ends_at,
        newPostsLimit: held.new_posts_limit,
        paidCents: Number(payment.amount_cents),
        individualSlots: (slots?.individual.held ?? 0) > 0,
      },
    };
  } catch {
    return none;
  }
}
