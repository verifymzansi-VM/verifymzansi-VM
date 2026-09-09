import { appendProviderWebhook } from "@/lib/payments/types";
import type { MarketplaceArea, PaymentProvider, PaymentStatus } from "@/types/enums";

type PaymentQueryResult = {
  data: PaymentRow | null;
  error?: { message?: string } | null;
};

type PaymentUpdateFilter = {
  eq: (column: string, value: string) => PaymentUpdateFilter;
  in: (column: string, values: string[]) => PaymentUpdateFilter;
  select: (columns: string) => Promise<{
    data: { id: string }[] | null;
    error?: { message?: string } | null;
  }>;
};

export type PaymentStoreClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        maybeSingle: () => Promise<PaymentQueryResult>;
      };
    };
    update: (value: Record<string, unknown>) => PaymentUpdateFilter;
  };
};

export type PaymentRow = {
  id: string;
  area: MarketplaceArea;
  status: PaymentStatus;
  provider: PaymentProvider;
  provider_payment_id: string | null;
  provider_reference: string | null;
  provider_data: Record<string, unknown> | null;
  amount_cents: number;
  user_id: string;
  created_at?: string;
};

export async function getPaymentById(
  supabase: PaymentStoreClient,
  paymentId: string
): Promise<PaymentRow | null> {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, area, status, provider, provider_payment_id, provider_reference, provider_data, amount_cents, user_id, created_at"
    )
    .eq("id", paymentId)
    .maybeSingle();

  // A query failure must be distinguishable from "not found" — callers that
  // treat null as "missing" would otherwise ack webhooks that must be retried.
  if (error) {
    throw new Error(`Payment lookup failed: ${error.message ?? "unknown error"}`);
  }

  return (data as PaymentRow | null) ?? null;
}

export async function getPaymentByProviderReference(
  supabase: PaymentStoreClient,
  providerReference: string
): Promise<PaymentRow | null> {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, area, status, provider, provider_payment_id, provider_reference, provider_data, amount_cents, user_id, created_at"
    )
    .eq("provider_reference", providerReference)
    .maybeSingle();

  if (error) {
    throw new Error(`Payment lookup failed: ${error.message ?? "unknown error"}`);
  }

  return (data as PaymentRow | null) ?? null;
}

export async function markPaymentFailed(
  supabase: PaymentStoreClient,
  payment: PaymentRow,
  webhookPayload: Record<string, unknown>
): Promise<boolean> {
  // Extract a machine-readable failure reason from the webhook for easier triage.
  // Ozow sends `status` (e.g. "Error") and may include `statusMessage`.
  const rawStatus =
    typeof webhookPayload.status === "string" ? webhookPayload.status.toLowerCase() : "unknown";
  const statusMessage =
    typeof webhookPayload.statusMessage === "string" ? webhookPayload.statusMessage : undefined;

  const providerData = appendProviderWebhook(
    {
      id: payment.id,
      user_id: payment.user_id,
      area: payment.area,
      amount_cents: payment.amount_cents,
      status: payment.status,
      provider: "ozow",
      provider_payment_id: payment.provider_payment_id,
      provider_reference: payment.provider_reference,
      provider_data: payment.provider_data,
    },
    webhookPayload
  );

  // Only pending payments may fail: processing is owned by a successful callback.
  // A terminal "complete" payment must never be downgraded by a late,
  // duplicated, or contradictory error webhook (see Ozow webhook route).
  const { data, error } = await supabase
    .from("payments")
    .update({
      status: "failed",
      provider_data: {
        ...(providerData ?? {}),
        failure_reason: rawStatus,
        ...(statusMessage ? { failure_message: statusMessage } : {}),
        failed_at: new Date().toISOString(),
      },
    })
    .eq("id", payment.id)
    .eq("provider", "ozow")
    .in("status", ["pending"])
    .select("id");

  if (error) return false;
  // Zero rows means the payment was already in a terminal state (e.g. a
  // concurrent webhook completed it between our read and this update).
  return Boolean(data?.length);
}
