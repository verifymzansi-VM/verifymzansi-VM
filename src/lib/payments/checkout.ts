import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import {
  createOzowHostedPayment,
  OzowAuthenticationError,
  OzowConfigurationError,
  OzowProviderError,
  toOzowMerchantReference,
} from "./ozow";
import type { MarketplaceArea } from "@/types/enums";

const log = createLogger("PaymentCheckout");

export interface PaymentCheckoutInput {
  admin: {
    from: (table: string) => {
      insert: (value: Record<string, unknown>) => {
        select: (columns: string) => {
          single: () => Promise<{
            data: { id: string } | null;
            error: { message?: string; code?: string } | null;
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

function getOzowFailureCode(error: unknown): string | undefined {
  if (
    error instanceof OzowConfigurationError ||
    error instanceof OzowAuthenticationError ||
    error instanceof OzowProviderError
  ) {
    return error.code;
  }

  return undefined;
}

export async function createHostedCheckout(
  input: PaymentCheckoutInput
): Promise<PaymentCheckoutResult> {
  const paymentId = crypto.randomUUID();
  const providerReference = toOzowMerchantReference(paymentId);
  const returnUrl = input.returnUrl.replace("__PAYMENT_ID__", paymentId);
  const cancelUrl = input.cancelUrl.replace("__PAYMENT_ID__", paymentId);
  const providerData = {
    ...input.providerData,
    created_at: new Date().toISOString(),
    merchant_reference: providerReference,
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
      provider_reference: providerReference,
      provider_data: providerData,
    })
    .select("id")
    .single();

  if (insertError || !payment) {
    // Unique constraint on (user_id, area) WHERE status IN ('pending','processing')
    // catches the TOCTOU race where two concurrent checkouts both pass the
    // application-level "no pending payment" check.
    if (insertError?.code === "23505") {
      throw new Error("A checkout for this area is already in progress");
    }
    log.error("Failed to create pending payment", { error: insertError?.message });
    throw new Error("Failed to create payment");
  }

  let paymentMarkedFailed = false;

  try {
    const ozowPayment = await createOzowHostedPayment({
      paymentId,
      merchantReference: providerReference,
      amountCents: input.amountCents,
      itemName: input.itemName,
      itemDescription: input.itemDescription,
      returnUrl,
      cancelUrl,
    });

    const { error: updateError } = await input.admin
      .from("payments")
      .update({
        provider_payment_id: ozowPayment.providerPaymentId,
        provider_reference: ozowPayment.providerReference,
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

    if (updateError) {
      log.error("Failed to update payment with provider details", {
        paymentId,
        error: updateError.message,
      });
      // Mark payment as failed so it doesn't dangle without provider details
      await input.admin
        .from("payments")
        .update({
          status: "failed",
          provider_data: {
            ...providerData,
            last_error: `Post-checkout update failed: ${updateError.message}`,
          },
        })
        .eq("id", paymentId)
        .eq("provider", "ozow");
      paymentMarkedFailed = true;
      throw new Error(`Failed to update payment with provider details: ${updateError.message}`);
    }

    return {
      paymentId,
      checkoutUrl: ozowPayment.redirectUrl,
    };
  } catch (error) {
    const errorCode = getOzowFailureCode(error);
    if (!paymentMarkedFailed) {
      await input.admin
        .from("payments")
        .update({
          status: "failed",
          provider_data: {
            ...providerData,
            last_error: error instanceof Error ? error.message : "Unknown checkout error",
            ...(errorCode ? { last_error_code: errorCode } : {}),
          },
        })
        .eq("id", paymentId)
        .eq("provider", "ozow");
    }

    throw error;
  }
}
