import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import { createOzowHostedPayment } from "./ozow";
import type { MarketplaceArea } from "@/types/enums";

const log = createLogger("PaymentCheckout");

export interface PaymentCheckoutInput {
  admin: {
    from: (table: string) => {
      insert: (value: Record<string, unknown>) => {
        select: (columns: string) => {
          single: () => Promise<{
            data: { id: string } | null;
            error: { message?: string } | null;
          }>;
        };
      };
      update: (value: Record<string, unknown>) => {
        eq: (
          column: string,
          value: string
        ) => {
          eq: (column: string, value: string) => Promise<{ error?: { message?: string } | null }>;
        };
      };
    };
  };
  userId: string;
  area: MarketplaceArea;
  amountCents: number;
  itemName: string;
  itemDescription?: string;
  returnUrl: string;
  cancelUrl: string;
  providerData: Record<string, unknown>;
}

export interface PaymentCheckoutResult {
  paymentId: string;
  checkoutUrl: string;
}

export async function createHostedCheckout(
  input: PaymentCheckoutInput
): Promise<PaymentCheckoutResult> {
  const paymentId = crypto.randomUUID();
  const returnUrl = input.returnUrl.replace("__PAYMENT_ID__", paymentId);
  const cancelUrl = input.cancelUrl.replace("__PAYMENT_ID__", paymentId);
  const providerData = {
    ...input.providerData,
    created_at: new Date().toISOString(),
  };

  const { data: payment, error: insertError } = await input.admin
    .from("payments")
    .insert({
      id: paymentId,
      user_id: input.userId,
      area: input.area,
      amount_cents: input.amountCents,
      status: "pending",
      provider: "ozow",
      provider_reference: paymentId,
      provider_data: providerData,
    })
    .select("id")
    .single();

  if (insertError || !payment) {
    log.error("Failed to create pending payment", { error: insertError?.message });
    throw new Error("Failed to create payment");
  }

  try {
    const ozowPayment = await createOzowHostedPayment({
      paymentId,
      amountCents: input.amountCents,
      itemName: input.itemName,
      itemDescription: input.itemDescription,
      returnUrl,
      cancelUrl,
    });

    await input.admin
      .from("payments")
      .update({
        provider_payment_id: ozowPayment.providerPaymentId,
        provider_data: {
          ...providerData,
          expire_at: ozowPayment.expireAt,
          correlation_id: ozowPayment.correlationId,
          idempotency_key: ozowPayment.idempotencyKey,
          checkout: ozowPayment.rawResponse,
          checkout_url: ozowPayment.redirectUrl,
        },
      })
      .eq("id", paymentId)
      .eq("provider", "ozow");

    return {
      paymentId,
      checkoutUrl: ozowPayment.redirectUrl,
    };
  } catch (error) {
    await input.admin
      .from("payments")
      .update({
        status: "failed",
        provider_data: {
          ...providerData,
          last_error: error instanceof Error ? error.message : "Unknown checkout error",
        },
      })
      .eq("id", paymentId)
      .eq("provider", "ozow");

    throw error;
  }
}
