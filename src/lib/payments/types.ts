import type { MarketplaceArea, PaymentProvider, PaymentStatus } from "@/types/enums";

export interface PaymentRecordShape {
  id: string;
  user_id: string | null;
  area: MarketplaceArea;
  amount_cents: number;
  status: PaymentStatus;
  provider?: PaymentProvider | null;
  provider_payment_id?: string | null;
  provider_reference?: string | null;
  provider_data?: Record<string, unknown> | null;
  created_at?: string | null;
}

export type PaymentMetadata = Record<string, unknown> & { type?: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function getPaymentMetadata(payment: PaymentRecordShape): PaymentMetadata | null {
  const providerData = asRecord(payment.provider_data);
  if (providerData) {
    const nestedMetadata = asRecord(providerData.metadata);
    if (nestedMetadata?.type) {
      return nestedMetadata as PaymentMetadata;
    }
    if (providerData.type) {
      return providerData as PaymentMetadata;
    }
  }

  return null;
}

export function appendProviderWebhook(
  payment: PaymentRecordShape,
  webhookPayload: Record<string, unknown>
): Record<string, unknown> | null {
  const providerData = asRecord(payment.provider_data);
  if (providerData) {
    const existing = Array.isArray(providerData.webhooks)
      ? (providerData.webhooks as unknown[])
      : [];
    return {
      ...providerData,
      webhooks: [...existing, webhookPayload],
      last_webhook_at: new Date().toISOString(),
    };
  }

  return {
    webhooks: [webhookPayload],
    last_webhook_at: new Date().toISOString(),
  };
}
