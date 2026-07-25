interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ExportedHandler<E = Record<string, unknown>> {
  fetch?(request: Request, env: E, ctx: ExecutionContext): Promise<Response>;
  scheduled?(event: ScheduledEvent, env: E, ctx: ExecutionContext): Promise<void>;
}

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_API_KEY: string;
  PROCESSING_PAYMENT_STALE_MINUTES?: string;
}

interface PaymentRow {
  id: string;
  user_id?: string | null;
  area?: string | null;
  status?: string;
  provider_data: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Fallback expiry window for pending payments that never received an
 * `expire_at` timestamp (e.g. a crash between the insert and the update).
 * Without this they would stay `pending` forever and block the user from
 * ever checking out again via the unique in-flight payment index.
 */
const PENDING_PAYMENT_FALLBACK_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Constant-time shared-secret comparison. workerd has no node:crypto
 * `timingSafeEqual`, so use a length-normalized XOR loop instead.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLength; i += 1) {
    const aCode = i < a.length ? a.charCodeAt(i) : 0;
    const bCode = i < b.length ? b.charCodeAt(i) : 0;
    diff |= aCode ^ bCode;
  }
  return diff === 0;
}

function getExpireAt(providerData: Record<string, unknown> | null): string | null {
  const value = providerData?.expire_at;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getProcessingStartedAt(payment: PaymentRow): string | null {
  const value = payment.provider_data?.processing_started_at;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return payment.updated_at ?? null;
}

function getFulfillmentCompletedAt(payment: PaymentRow): string | null {
  const value = payment.provider_data?.fulfillment_completed_at;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mergeProviderData(
  payment: PaymentRow,
  updates: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(payment.provider_data ?? {}),
    ...updates,
  };
}

async function patchPayment(
  env: Env,
  paymentId: string,
  expectedStatus: "pending" | "processing",
  body: Record<string, unknown>
): Promise<boolean> {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const params = new URLSearchParams({
    id: `eq.${paymentId}`,
    status: `eq.${expectedStatus}`,
    select: "id",
  });

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/payments?${params.toString()}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error(`Payment cleanup patch failed for ${paymentId}`, await response.text());
    return false;
  }

  const updatedRows = (await response.json()) as Array<{ id: string }>;
  if (updatedRows.length === 0) {
    console.warn(
      `Payment cleanup skipped ${paymentId}; status changed from ${expectedStatus} before patch`
    );
    return false;
  }

  return true;
}

async function createNotification(
  env: Env,
  userId: string,
  title: string,
  message: string,
  href = "/billing"
): Promise<boolean> {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/notifications`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user_id: userId,
      type: "warning",
      title,
      message,
      href,
    }),
  });

  if (!response.ok) {
    console.error(
      `Payment cleanup notification insert failed for ${userId}`,
      await response.text()
    );
    return false;
  }

  return true;
}

const worker: ExportedHandler<Env> = {
  async scheduled(_event, env) {
    const headers = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    // Order by created_at so expired rows beyond the first page are not
    // starved by newer unexpired pending payments.
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/payments?provider=eq.ozow&status=eq.pending&select=id,user_id,area,provider_data,created_at&order=created_at.asc&limit=200`,
      { headers }
    );

    if (!response.ok) {
      console.error("Payment cleanup fetch failed", await response.text());
      return;
    }

    const payments = ((await response.json()) as PaymentRow[]).filter((payment) => {
      const expireAt = getExpireAt(payment.provider_data);
      if (expireAt) {
        return new Date(expireAt) <= new Date();
      }
      // Pending payments that never received expire_at (crash between insert
      // and update) still block checkout via the unique in-flight index —
      // expire them once they pass the fallback window.
      const createdAt = payment.created_at ? new Date(payment.created_at).getTime() : NaN;
      return (
        Number.isFinite(createdAt) && Date.now() - createdAt >= PENDING_PAYMENT_FALLBACK_EXPIRY_MS
      );
    });

    const processingResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/payments?provider=eq.ozow&status=eq.processing&select=id,status,provider_data,updated_at&limit=200`,
      { headers }
    );

    if (!processingResponse.ok) {
      console.error("Payment cleanup processing fetch failed", await processingResponse.text());
      return;
    }

    const staleMinutes = Math.max(
      5,
      Number.parseInt(env.PROCESSING_PAYMENT_STALE_MINUTES || "30", 10) || 30
    );
    const staleThresholdMs = staleMinutes * 60 * 1000;
    const processingPayments = (await processingResponse.json()) as PaymentRow[];

    let expiredPending = 0;
    let recoveredComplete = 0;
    let failedStaleProcessing = 0;
    let expiryNotifications = 0;

    for (const payment of payments) {
      const updated = await patchPayment(env, payment.id, "pending", {
        status: "expired",
        provider_data: mergeProviderData(payment, {
          cleanup_reconciled_at: new Date().toISOString(),
          cleanup_reconciliation_state: "expired_pending",
        }),
      });
      if (updated) {
        expiredPending += 1;
        if (payment.user_id) {
          const notified = await createNotification(
            env,
            payment.user_id,
            "Payment expired",
            "Your pending payment expired before completion. Start checkout again to activate your plan.",
            "/billing"
          );
          if (notified) {
            expiryNotifications += 1;
          }
        }
      }
    }

    for (const payment of processingPayments) {
      const processingStartedAt = getProcessingStartedAt(payment);
      if (!processingStartedAt) {
        continue;
      }

      const isStale = Date.now() - new Date(processingStartedAt).getTime() >= staleThresholdMs;
      if (!isStale) {
        continue;
      }

      const fulfillmentCompletedAt = getFulfillmentCompletedAt(payment);
      if (fulfillmentCompletedAt) {
        const updated = await patchPayment(env, payment.id, "processing", {
          status: "complete",
          provider_data: mergeProviderData(payment, {
            completed_at: new Date().toISOString(),
            cleanup_reconciled_at: new Date().toISOString(),
            cleanup_reconciliation_state: "recovered_complete",
            fulfillment_state: "completed",
          }),
        });
        if (updated) {
          recoveredComplete += 1;
        }
        continue;
      }

      const updated = await patchPayment(env, payment.id, "processing", {
        status: "failed",
        provider_data: mergeProviderData(payment, {
          cleanup_reconciled_at: new Date().toISOString(),
          cleanup_reconciliation_state: "stale_processing_failed",
          cleanup_reconciliation_reason: "processing_timeout",
        }),
      });
      if (updated) {
        failedStaleProcessing += 1;
      }
    }

    if (expiredPending === 0 && recoveredComplete === 0 && failedStaleProcessing === 0) {
      return;
    }

    const auditPayload = {
      actor_id: "00000000-0000-0000-0000-000000000000",
      actor_role: "system",
      action: "payment_cleanup_reconciliation",
      target_type: "payment",
      // audit_logs.target_id is UUID NOT NULL — use the nil-UUID sentinel
      // (same as src/lib/services/audit.ts) and keep batch detail in metadata.
      target_id: "00000000-0000-0000-0000-000000000000",
      area: null,
      metadata: {
        target: "batch",
        expired_pending: expiredPending,
        recovered_complete: recoveredComplete,
        failed_stale_processing: failedStaleProcessing,
        expiry_notifications: expiryNotifications,
        processing_stale_minutes: staleMinutes,
        run_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    };

    const auditResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/audit_logs`, {
      method: "POST",
      headers,
      body: JSON.stringify(auditPayload),
    });

    if (!auditResponse.ok) {
      console.error("Payment cleanup audit insert failed", await auditResponse.text());
    }
  },

  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      const authHeader = request.headers.get("Authorization");
      const expectedAuthHeader = env.WORKER_API_KEY ? `Bearer ${env.WORKER_API_KEY}` : "";
      if (!expectedAuthHeader || !timingSafeEqual(authHeader ?? "", expectedAuthHeader)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      await this.scheduled!({} as ScheduledEvent, env, ctx);
      return new Response(JSON.stringify({ triggered: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        worker: "verifymzansi-payment-cleanup",
        status: "healthy",
        schedule: "*/10 * * * *",
        processingStaleMinutes: env.PROCESSING_PAYMENT_STALE_MINUTES || "30",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  },
};

export default worker;
