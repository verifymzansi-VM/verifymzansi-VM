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

interface KycArtifactOwnership {
  r2_key: string;
  user_id: string;
}

interface AccountHoldRow {
  user_id: string;
}

interface AuthAdminUser {
  id: string;
  created_at?: string;
  email?: string | null;
}

type ExpirableContentTable = "listings" | "businesses" | "promotions";

const AUTH_USERS_PAGE_SIZE = 200;
const AUTH_USERS_MAX_PAGES = 5;
const ORPHAN_AUTH_MIN_AGE_MS = 30 * 60 * 1000;
const ORPHAN_AUTH_DELETE_CAP = 50;

function buildInFilter(values: string[]): string {
  return `(${values.map((value) => JSON.stringify(value)).join(",")})`;
}

function isPrivateBucket(bucket: string): boolean {
  return bucket === "private" || bucket === "verifymzansi-private";
}

function isPublicBucket(bucket: string): boolean {
  return bucket === "public" || bucket === "verifymzansi-public";
}

async function getHeldKycKeys(
  records: CleanupRecord[],
  env: Env,
  headers: Record<string, string>
): Promise<Set<string>> {
  const candidateKeys = records
    .filter((record) => isPrivateBucket(record.bucket))
    .map((r) => r.r2_key);
  if (candidateKeys.length === 0) {
    return new Set<string>();
  }

  const artifactsResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/kyc_artifacts?select=r2_key,user_id&r2_key=in.${encodeURIComponent(buildInFilter(candidateKeys))}`,
    { headers }
  );

  if (!artifactsResponse.ok) {
    console.error(
      "Failed to resolve queued KYC artifacts for legal-hold check:",
      await artifactsResponse.text()
    );
    return new Set<string>();
  }

  const artifacts = (await artifactsResponse.json()) as KycArtifactOwnership[];
  const userIds = [...new Set(artifacts.map((artifact) => artifact.user_id))];
  if (userIds.length === 0) {
    return new Set<string>();
  }

  const holdsResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/account_profiles?select=user_id&legal_hold=is.true&user_id=in.${encodeURIComponent(buildInFilter(userIds))}`,
    { headers }
  );

  if (!holdsResponse.ok) {
    console.error(
      "Failed to resolve legal holds for queued KYC artifacts:",
      await holdsResponse.text()
    );
    return new Set<string>();
  }

  const heldUsers = new Set(
    ((await holdsResponse.json()) as AccountHoldRow[]).map((row) => row.user_id)
  );
  return new Set(
    artifacts
      .filter((artifact) => heldUsers.has(artifact.user_id))
      .map((artifact) => artifact.r2_key)
  );
}

function parseCreatedAt(value?: string): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

async function listAuthUsersPage(
  env: Env,
  headers: Record<string, string>,
  page: number
): Promise<AuthAdminUser[]> {
  const response = await fetch(
    `${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${AUTH_USERS_PAGE_SIZE}`,
    { headers }
  );

  if (!response.ok) {
    console.error("Failed to list auth users for orphan sweep:", await response.text());
    return [];
  }

  const payload = (await response.json()) as { users?: AuthAdminUser[] };
  return payload.users ?? [];
}

async function resolveExistingProfileUserIds(
  env: Env,
  headers: Record<string, string>,
  userIds: string[]
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set<string>();
  }

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/account_profiles?select=user_id&user_id=in.${encodeURIComponent(buildInFilter(userIds))}`,
    { headers }
  );

  if (!response.ok) {
    console.error("Failed to resolve account profiles for orphan sweep:", await response.text());
    return new Set<string>();
  }

  const rows = (await response.json()) as Array<{ user_id: string }>;
  return new Set(rows.map((row) => row.user_id));
}

async function deleteAuthUser(
  env: Env,
  headers: Record<string, string>,
  userId: string
): Promise<boolean> {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    console.error(`Failed to delete orphan auth user ${userId}:`, await response.text());
    return false;
  }

  return true;
}

async function cleanupOrphanedAuthUsers(
  env: Env,
  headers: Record<string, string>
): Promise<number> {
  const now = Date.now();
  const candidates: AuthAdminUser[] = [];

  for (let page = 1; page <= AUTH_USERS_MAX_PAGES; page += 1) {
    const users = await listAuthUsersPage(env, headers, page);
    if (users.length === 0) {
      break;
    }

    for (const user of users) {
      const createdAt = parseCreatedAt(user.created_at);
      if (!createdAt) {
        continue;
      }
      if (now - createdAt < ORPHAN_AUTH_MIN_AGE_MS) {
        continue;
      }
      candidates.push(user);
    }

    if (users.length < AUTH_USERS_PAGE_SIZE) {
      break;
    }
  }

  if (candidates.length === 0) {
    return 0;
  }

  const existingProfileUserIds = await resolveExistingProfileUserIds(
    env,
    headers,
    candidates.map((user) => user.id)
  );

  const orphans = candidates
    .filter((user) => !existingProfileUserIds.has(user.id))
    .slice(0, ORPHAN_AUTH_DELETE_CAP);

  let deletedCount = 0;
  for (const orphan of orphans) {
    const deleted = await deleteAuthUser(env, headers, orphan.id);
    if (deleted) {
      deletedCount += 1;
    }
  }

  return deletedCount;
}

async function expireContentTable(
  env: Env,
  headers: Record<string, string>,
  table: ExpirableContentTable,
  nowIso: string
): Promise<number> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${table}?status=eq.live&expires_at=not.is.null&expires_at=lte.${encodeURIComponent(nowIso)}`,
    {
      method: "PATCH",
      headers: {
        ...headers,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        status: "expired",
        status_reason: "Free post visibility period expired",
      }),
    }
  );

  if (!response.ok) {
    console.error(`Failed to expire ${table}:`, await response.text());
    return 0;
  }

  const rows = (await response.json()) as Array<{ id: string }>;
  return rows.length;
}

async function expireElapsedFreePosts(
  env: Env,
  headers: Record<string, string>
): Promise<Record<ExpirableContentTable, number>> {
  const nowIso = new Date().toISOString();
  const [listings, businesses, promotions] = await Promise.all([
    expireContentTable(env, headers, "listings", nowIso),
    expireContentTable(env, headers, "businesses", nowIso),
    expireContentTable(env, headers, "promotions", nowIso),
  ]);

  return { listings, businesses, promotions };
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
    } else {
      console.warn(`Processing ${records.length} R2 cleanup record(s)…`);
    }

    let successCount = 0;
    let failCount = 0;
    let heldSkipCount = 0;

    const heldKeys = await getHeldKycKeys(records, env, headers);

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
        const bucketBinding = isPrivateBucket(bucket)
          ? env.R2_PRIVATE
          : isPublicBucket(bucket)
            ? env.R2_PUBLIC
            : null;

        if (!bucketBinding) {
          console.error(`Unsupported cleanup bucket '${bucket}'`);
          failCount += bucketRecords.length;
          continue;
        }

        const actionableRecords = bucketRecords.filter((record) => !heldKeys.has(record.r2_key));
        const skippedRecords = bucketRecords.filter((record) => heldKeys.has(record.r2_key));

        if (skippedRecords.length > 0) {
          heldSkipCount += skippedRecords.length;
          console.warn(
            `Skipping ${skippedRecords.length} queued cleanup record(s) because a legal hold is active.`
          );
        }

        if (actionableRecords.length === 0) {
          continue;
        }

        const keys = actionableRecords.map((record) => record.r2_key);

        try {
          await bucketBinding.delete(keys);
        } catch (err) {
          console.error(`Failed to batch-delete ${bucket} R2 keys:`, err);
          failCount += actionableRecords.length;
          continue;
        }

        const batchIds = actionableRecords.map((record) => record.id);
        try {
          const markResponse = await fetch(
            `${supabaseUrl}/rest/v1/r2_cleanup_queue?id=in.(${batchIds.join(",")})`,
            {
              method: "PATCH",
              headers,
              body: JSON.stringify({
                processed_at: new Date().toISOString(),
              }),
            }
          );

          if (!markResponse.ok) {
            console.error(
              `Failed to mark ${bucket} cleanup batch as processed:`,
              await markResponse.text()
            );
            failCount += actionableRecords.length;
            continue;
          }

          successCount += actionableRecords.length;
        } catch (err) {
          console.error(`Failed to mark ${bucket} cleanup batch as processed:`, err);
          failCount += actionableRecords.length;
        }
      }
    }

    // 4. Clean up orphaned media uploads (uploaded but never confirmed after 24 hours)
    let orphanDeleteCount = 0;
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const orphanRes = await fetch(
        `${supabaseUrl}/rest/v1/media_uploads?confirmed_at=is.null&created_at=lt.${cutoff}&order=created_at.asc&limit=100&select=id,r2_key,bucket`,
        { headers }
      );

      if (orphanRes.ok) {
        const orphans: { id: string; r2_key: string; bucket: string }[] = await orphanRes.json();
        if (orphans.length > 0) {
          console.warn(`Found ${orphans.length} orphaned media upload(s) to clean up.`);

          const publicKeys = orphans.filter((o) => isPublicBucket(o.bucket)).map((o) => o.r2_key);
          const privateKeys = orphans.filter((o) => isPrivateBucket(o.bucket)).map((o) => o.r2_key);

          if (publicKeys.length > 0) {
            try {
              await env.R2_PUBLIC.delete(publicKeys);
            } catch (e) {
              console.error("Failed to delete orphaned public R2 keys:", e);
            }
          }
          if (privateKeys.length > 0) {
            try {
              await env.R2_PRIVATE.delete(privateKeys);
            } catch (e) {
              console.error("Failed to delete orphaned private R2 keys:", e);
            }
          }

          const orphanIds = orphans.map((o) => o.id);
          const deleteRes = await fetch(
            `${supabaseUrl}/rest/v1/media_uploads?id=in.(${orphanIds.join(",")})`,
            { method: "DELETE", headers }
          );
          if (deleteRes.ok) {
            orphanDeleteCount = orphans.length;
          } else {
            console.error("Failed to delete orphan tracking records:", await deleteRes.text());
          }
        }
      } else {
        console.warn("Failed to fetch orphaned media uploads:", await orphanRes.text());
      }
    } catch (orphanErr) {
      console.error("Orphan media cleanup failed:", orphanErr);
    }

    // 5. Clean up orphaned auth users that have no account_profiles row.
    let orphanAuthUsersDeleted = 0;
    try {
      orphanAuthUsersDeleted = await cleanupOrphanedAuthUsers(env, headers);
    } catch (orphanAuthErr) {
      console.error("Orphan auth user cleanup failed:", orphanAuthErr);
    }

    // 6. Expire free posts whose visibility window has elapsed.
    let expiredContent = { listings: 0, businesses: 0, promotions: 0 };
    try {
      expiredContent = await expireElapsedFreePosts(env, headers);
    } catch (expireErr) {
      console.error("Free post expiry sweep failed:", expireErr);
    }

    // 7. Log cleanup summary to audit_logs via REST API
    const auditPayload = {
      actor_id: "00000000-0000-0000-0000-000000000000", // system actor
      actor_role: "system",
      action: "retention_r2_cleanup",
      target_type: "r2_cleanup_queue",
      target_id: "batch",
      area: null,
      metadata: {
        total: records.length,
        success: successCount,
        failed: failCount,
        held_skipped: heldSkipCount,
        orphan_media_deleted: orphanDeleteCount,
        orphan_auth_users_deleted: orphanAuthUsersDeleted,
        expired_content: expiredContent,
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

    console.warn(
      `Retention cleanup complete: ${successCount} deleted, ${failCount} failed, ${heldSkipCount} skipped for legal hold, ${orphanDeleteCount} orphaned media deleted, ${orphanAuthUsersDeleted} orphaned auth users deleted, expired content: listings=${expiredContent.listings}, businesses=${expiredContent.businesses}, promotions=${expiredContent.promotions}.`
    );
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
