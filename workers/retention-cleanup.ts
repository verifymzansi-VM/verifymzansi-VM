/**
 * Cloudflare Worker — Data Retention R2 Cleanup
 *
 * Scheduled cron trigger that processes the r2_cleanup_queue table.
 * Deletes files from R2 private bucket and logs cleanup via REST API.
 *
 * Deploy as a separate worker or extend the existing wrangler.toml.
 *
 * Required bindings:
 *   - R2_PRIVATE: R2 bucket binding for private files
 *   - R2_PUBLIC: R2 bucket binding for public media files
 *   - SUPABASE_URL: Supabase REST API URL
 *   - SUPABASE_SERVICE_KEY: Supabase service role key
 */

// ---------------------------------------------------------------------------
// Cloudflare Worker type stubs (avoids needing @cloudflare/workers-types in
// the main Next.js tsconfig).  Install the package for full type coverage.
// ---------------------------------------------------------------------------

interface R2Bucket {
  delete(key: string | string[]): Promise<void>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | string | null): Promise<R2Object>;
}
interface R2Object {
  key: string;
  size: number;
}
interface R2ObjectBody extends R2Object {
  body: ReadableStream;
}
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
  R2_PUBLIC: R2Bucket;
  R2_PRIVATE: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_API_KEY: string; // Shared secret for authenticating manual triggers
}

interface CleanupRecord {
  id: string;
  bucket: string;
  r2_key: string;
  reason: string;
}

const worker: ExportedHandler<Env> = {
  /**
   * Cron trigger: runs daily at 03:00 UTC
   * Processes all unprocessed records in r2_cleanup_queue.
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    // 1. Fetch unprocessed cleanup records (max 200 per run)
    const fetchRes = await fetch(
      `${supabaseUrl}/rest/v1/r2_cleanup_queue?processed_at=is.null&order=created_at.asc&limit=200`,
      { headers }
    );

    if (!fetchRes.ok) {
      console.error("Failed to fetch cleanup queue:", await fetchRes.text());
      return;
    }

    const records: CleanupRecord[] = await fetchRes.json();

    if (records.length === 0) {
      console.warn("No R2 files queued for cleanup.");
      return;
    }

    console.warn(`Processing ${records.length} R2 cleanup record(s)…`);

    let successCount = 0;
    let failCount = 0;

    // Batch R2 deletes (the API accepts an array of keys) and track results.
    // Records can target different buckets, so each batch is grouped per bucket.
    const BATCH_SIZE = 50;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const bucketGroups = new Map<string, CleanupRecord[]>();
      for (const record of batch) {
        const current = bucketGroups.get(record.bucket) ?? [];
        current.push(record);
        bucketGroups.set(record.bucket, current);
      }

      for (const [bucket, bucketRecords] of bucketGroups.entries()) {
        const bucketBinding =
          bucket === "private" ? env.R2_PRIVATE : bucket === "public" ? env.R2_PUBLIC : null;

        if (!bucketBinding) {
          console.error(`Unsupported cleanup bucket '${bucket}'`);
          failCount += bucketRecords.length;
          continue;
        }

        const keys = bucketRecords.map((record) => record.r2_key);

        try {
          await bucketBinding.delete(keys);
        } catch (err) {
          console.error(`Failed to batch-delete ${bucket} R2 keys:`, err);
          failCount += bucketRecords.length;
          continue;
        }

        const batchIds = bucketRecords.map((record) => record.id);
        try {
          await fetch(`${supabaseUrl}/rest/v1/r2_cleanup_queue?id=in.(${batchIds.join(",")})`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              processed_at: new Date().toISOString(),
            }),
          });
          successCount += bucketRecords.length;
        } catch (err) {
          console.error(`Failed to mark ${bucket} cleanup batch as processed:`, err);
          failCount += bucketRecords.length;
        }
      }
    }

    // 4. Log cleanup summary to audit_logs via REST API
    const auditPayload = {
      actor_id: "00000000-0000-0000-0000-000000000000", // system actor
      actor_role: "admin",
      action: "retention_r2_cleanup",
      target_type: "r2_cleanup_queue",
      target_id: "batch",
      area: null,
      metadata: {
        total: records.length,
        success: successCount,
        failed: failCount,
        run_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    };

    const auditRes = await fetch(`${supabaseUrl}/rest/v1/audit_logs`, {
      method: "POST",
      headers,
      body: JSON.stringify(auditPayload),
    });

    if (!auditRes.ok) {
      console.warn(
        `[Retention] Audit log insert failed: ${auditRes.status} ${auditRes.statusText}`
      );
    }

    console.warn(`Retention cleanup complete: ${successCount} deleted, ${failCount} failed.`);
  },

  /**
   * HTTP handler — health check / manual trigger
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "POST") {
      // Authenticate manual trigger via shared secret
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
        worker: "verifymzansi-retention-cleanup",
        status: "healthy",
        schedule: "0 3 * * *",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  },
};

export default worker;
