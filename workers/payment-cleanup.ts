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
  status?: string;
  provider_data: Record<string, unknown> | null;
  updated_at?: string | null;
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
  body: Record<string, unknown>
): Promise<boolean> {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/payments?id=eq.${paymentId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error(`Payment cleanup patch failed for ${paymentId}`, await response.text());
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

    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/payments?provider=eq.ozow&status=eq.pending&select=id,provider_data&limit=200`,
      { headers }
    );

    if (!response.ok) {
      console.error("Payment cleanup fetch failed", await response.text());
      return;
    }

    const payments = ((await response.json()) as PaymentRow[]).filter((payment) => {
      const expireAt = getExpireAt(payment.provider_data);
      return expireAt ? new Date(expireAt) <= new Date() : false;
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

    for (const payment of payments) {
      const updated = await patchPayment(env, payment.id, {
        status: "expired",
        provider_data: mergeProviderData(payment, {
          cleanup_reconciled_at: new Date().toISOString(),
          cleanup_reconciliation_state: "expired_pending",
        }),
      });
      if (updated) {
        expiredPending += 1;
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
        const updated = await patchPayment(env, payment.id, {
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

      const updated = await patchPayment(env, payment.id, {
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
      target_id: "batch",
      area: null,
      metadata: {
        expired_pending: expiredPending,
        recovered_complete: recoveredComplete,
        failed_stale_processing: failedStaleProcessing,
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
      if (!env.WORKER_API_KEY || authHeader !== `Bearer ${env.WORKER_API_KEY}`) {
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
