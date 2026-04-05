import { appendProviderWebhook } from "@/lib/payments/types";
import type { MarketplaceArea, PaymentProvider, PaymentStatus } from "@/types/enums";

export type PaymentStoreClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        maybeSingle: () => Promise<{ data: PaymentRow | null }>;
      };
    };
    update: (value: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string
      ) => {
        eq: (
          column: string,
          value: string
        ) => Promise<{ error?: { message?: string } | null }> & {
          eq: (column: string, value: string) => Promise<{ error?: { message?: string } | null }>;
          neq: (
            column: string,
            value: string
          ) => {
            neq: (
              column: string,
              value: string
            ) => {
              select: (columns: string) => Promise<{ data: { id: string }[] | null }>;
            };
          };
        };
        neq: (
          column: string,
          value: string
        ) => {
          neq: (
            column: string,
            value: string
          ) => {
            select: (columns: string) => Promise<{ data: { id: string }[] | null }>;
          };
        };
      };
    };
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
};

export type OzowNormalizedPayload = {
  providerPaymentId?: string | null;
  eventType?: string | null;
  rawPayload?: Record<string, unknown>;
};

export function asProviderData(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function hasFulfillmentCompletion(payment: PaymentRow): boolean {
  return typeof asProviderData(payment.provider_data)?.fulfillment_completed_at === "string";
}

function buildProviderDataWithMarkers(
  payment: PaymentRow,
  webhookPayload: Record<string, unknown>,
  extra: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(appendProviderWebhook(payment, webhookPayload) ?? {}),
    ...extra,
  };
}

export async function getPaymentById(
  supabase: PaymentStoreClient,
  paymentId: string
): Promise<PaymentRow | null> {
  const { data } = await supabase
    .from("payments")
    .select(
      "id, area, status, provider, provider_payment_id, provider_reference, provider_data, amount_cents, user_id"
    )
    .eq("id", paymentId)
    .maybeSingle();

  return (data as PaymentRow | null) ?? null;
}

export async function getPaymentByProviderReference(
  supabase: PaymentStoreClient,
  providerReference: string
): Promise<PaymentRow | null> {
  const { data } = await supabase
    .from("payments")
    .select(
      "id, area, status, provider, provider_payment_id, provider_reference, provider_data, amount_cents, user_id"
    )
    .eq("provider_reference", providerReference)
    .maybeSingle();

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

  const { error } = await supabase
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
    .eq("provider", "ozow");

  return !error;
}

export async function claimPaymentProcessing(
  supabase: PaymentStoreClient,
  payment: PaymentRow,
  payload: OzowNormalizedPayload
): Promise<boolean> {
  const { data: claimedRows } = await supabase
    .from("payments")
    .update({
      status: "processing",
      provider_payment_id: payload.providerPaymentId || payment.provider_payment_id,
      provider_reference: payment.provider_reference || payment.id,
      provider_data: {
        ...(asProviderData(payment.provider_data) ?? {}),
        processing_started_at:
          asProviderData(payment.provider_data)?.processing_started_at || new Date().toISOString(),
        last_event_type: payload.eventType || "transaction.complete",
      },
    })
    .eq("id", payment.id)
    .eq("provider", "ozow")
    .neq("status", "complete")
    .neq("status", "processing")
    .select("id");

  return Boolean(claimedRows?.length);
}

export async function persistFulfillmentCompletion(
  supabase: PaymentStoreClient,
  payment: PaymentRow,
  payload: OzowNormalizedPayload
): Promise<boolean> {
  const markerTimestamp = new Date().toISOString();
  const { error } = await supabase
    .from("payments")
    .update({
      provider_payment_id: payload.providerPaymentId || payment.provider_payment_id,
      provider_reference: payment.provider_reference || payment.id,
      provider_data: buildProviderDataWithMarkers(payment, payload.rawPayload ?? {}, {
        processing_started_at:
          asProviderData(payment.provider_data)?.processing_started_at ?? markerTimestamp,
        fulfillment_completed_at: markerTimestamp,
        fulfillment_state: "completed",
      }),
    })
    .eq("id", payment.id)
    .eq("provider", "ozow")
    .eq("status", "processing");

  return !error;
}

export async function finalizeCompletedPayment(
  supabase: PaymentStoreClient,
  payment: PaymentRow,
  payload: OzowNormalizedPayload
): Promise<boolean> {
  const providerData = asProviderData(payment.provider_data);
  const fulfillmentCompletedAt =
    typeof providerData?.fulfillment_completed_at === "string"
      ? providerData.fulfillment_completed_at
      : new Date().toISOString();

  const { error } = await supabase
    .from("payments")
    .update({
      status: "complete",
      provider_payment_id: payload.providerPaymentId || payment.provider_payment_id,
      provider_reference: payment.provider_reference || payment.id,
      provider_data: buildProviderDataWithMarkers(payment, payload.rawPayload ?? {}, {
        processing_started_at: providerData?.processing_started_at ?? fulfillmentCompletedAt,
        fulfillment_completed_at: fulfillmentCompletedAt,
        fulfillment_state: "completed",
        completed_at: new Date().toISOString(),
      }),
    })
    .eq("id", payment.id)
    .eq("provider", "ozow")
    .eq("status", "processing");

  return !error;
}
