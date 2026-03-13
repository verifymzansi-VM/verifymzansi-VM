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
}

interface PaymentRow {
  id: string;
  provider_data: Record<string, unknown> | null;
}

function getExpireAt(providerData: Record<string, unknown> | null): string | null {
  const value = providerData?.expire_at;
  return typeof value === "string" && value.length > 0 ? value : null;
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

    if (payments.length === 0) {
      return;
    }

    const ids = payments.map((payment) => payment.id).join(",");
    const updateResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/payments?id=in.(${ids})`, {
      method: "PATCH",
      headers: {
        ...headers,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status: "expired" }),
    });

    if (!updateResponse.ok) {
      console.error("Payment cleanup update failed", await updateResponse.text());
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
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  },
};

export default worker;
