import "server-only";
import { z } from "zod";
import { createFoundationServiceApi, type FoundationServiceApi } from "./service-api";
import { deleteFromR2, deleteManyFromR2, R2_DELETE_BATCH_LIMIT } from "../services/storage";
import { VARIANT_WIDTHS, variantKeyFor } from "../media/variant-keys";
import { createLogger } from "../utils/logger";

const log = createLogger("RetentionJobs");

/**
 * Limits for one run: one cron-triggered request to the app Worker
 * (wrangler.retention-cleanup.toml, every 5 minutes).
 *
 * - subrequests: every database call and every R2 S3-API call is one Worker
 *   subrequest; cleanup storage calls make no SDK retries, so the count is
 *   exact. This deployment runs with Workers Paid limits (1,000 per
 *   invocation; Free allows 50). 40 is deliberately conservative and fits
 *   either plan, leaving room for error reporting and the framework.
 * - mediaClaimPerRound: 100 objects x 4 keys = 400 keys, so one round needs
 *   one R2 batch request (limit 1,000 keys). With 40 subrequests a run
 *   reaches 27 to 35 objects; the cap matters only if the budget is raised.
 * - runMs: no new round starts after 20 s.
 * - deadlineMs: every database and storage call shares one 40 s deadline, so
 *   the run answers before the cron Worker gives up on it at 45 s.
 * - leaseMarginMs: claims hold a 5-minute lease. A row with less than a
 *   minute left is not touched; it is claimed again after the lease ends.
 * - slowClaimMs: a slower media claim is reported and ends the run's claims.
 */
type CleanupLimits = Record<
  | "subrequests"
  | "evidenceClaim"
  | "mediaClaimPerRound"
  | "rounds"
  | "runMs"
  | "deadlineMs"
  | "leaseMarginMs"
  | "slowClaimMs",
  number
>;
export const CLEANUP_LIMITS: Readonly<CleanupLimits> = Object.freeze({
  subrequests: 40,
  evidenceClaim: 4,
  mediaClaimPerRound: 100,
  rounds: 8,
  runMs: 20_000,
  deadlineMs: 40_000,
  leaseMarginMs: 60_000,
  slowClaimMs: 2_000,
});

/** The original and its display variants: deleted together, acknowledged once. */
const MEDIA_KEYS_PER_OBJECT = 1 + VARIANT_WIDTHS.length;

function checkedLimits(override: Partial<CleanupLimits>): CleanupLimits {
  const limits = { ...CLEANUP_LIMITS, ...override };
  if (
    !Object.values(limits).every((value) => Number.isSafeInteger(value) && value > 0) ||
    limits.mediaClaimPerRound * MEDIA_KEYS_PER_OBJECT > R2_DELETE_BATCH_LIMIT ||
    limits.evidenceClaim > 100 ||
    limits.mediaClaimPerRound > 500 ||
    limits.runMs >= limits.deadlineMs
  )
    throw new Error("Invalid storage cleanup limits");
  return limits;
}

const shared = {
  object_key: z.string(),
  claim_token: z.uuid(),
  lease_until: z.iso.datetime({ offset: true }),
};
const mediaRow = z.strictObject({
  ...shared,
  object_id: z.uuid(),
  object_key: z.string().regex(/^media\/[a-f0-9-]{36}$/),
});
const evidenceRow = z.strictObject({
  ...shared,
  artifact_id: z.uuid(),
  object_key: z.string().regex(/^evidence\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/),
});
type MediaRow = z.infer<typeof mediaRow>;

/**
 * Storage calls the cleanup makes; each is exactly one Worker subrequest and
 * honours the run's deadline. An error with `retryLater: true` means storage
 * is busy or did not answer: send nothing more this run.
 */
export type CleanupStorage = {
  deleteOne(bucket: string, key: string, signal: AbortSignal): Promise<void>;
  /** Returns the keys storage did not confirm as deleted. */
  deleteMany(bucket: string, keys: string[], signal: AbortSignal): Promise<string[]>;
};
const r2Storage: CleanupStorage = {
  deleteOne: (bucket, key, signal) =>
    deleteFromR2(bucket, key, { attempts: "single-attempt", signal }),
  deleteMany: (bucket, keys, signal) => deleteManyFromR2(bucket, keys, { signal }),
};

function retryLater(error: unknown) {
  return (error as { retryLater?: unknown } | null)?.retryLater === true;
}

function createBudget(limit: number) {
  let used = 0;
  return {
    get remaining() {
      return limit - used;
    },
    get used() {
      return used;
    },
    /** Callers size their work first; going over is a bug, so it throws. */
    take(count: number) {
      if (count > limit - used) throw new Error("Cleanup subrequest budget exceeded");
      used += count;
    },
  };
}
type Budget = ReturnType<typeof createBudget>;

function mediaKeys(row: MediaRow) {
  return [row.object_key, ...VARIANT_WIDTHS.map((width) => variantKeyFor(row.object_key, width))];
}

type RunContext = {
  service: FoundationServiceApi;
  storage: CleanupStorage;
  limits: CleanupLimits;
  budget: Budget;
  /** Aborts every database and storage call at the run's deadline. */
  signal: AbortSignal;
  /** False when a claim lease is too close to its end to start deleting. */
  leaseUsable(leaseUntil: string): boolean;
  elapsed(): number;
};

/**
 * One scheduled run: the bounded retention sweeps, then storage cleanup.
 * Storage cleanup runs even when a sweep fails. Anything that failed is
 * reported (log line at warn level, then an error, so the route answers 503)
 * after all the work that could be done is done.
 */
export async function runFoundationRetention(
  service: FoundationServiceApi = createFoundationServiceApi(),
  storage: CleanupStorage = r2Storage,
  options: { now?: () => number; limits?: Partial<CleanupLimits> } = {}
) {
  const now = options.now ?? Date.now;
  const limits = checkedLimits(options.limits ?? {});
  const started = now();
  const signal = AbortSignal.timeout(limits.deadlineMs);
  const budget = createBudget(limits.subrequests);
  budget.take(2);
  const [swept, drafts] = await Promise.allSettled([
    service.rpc("run_retention", { p_limit: 100 }).abortSignal(signal),
    service.rpc("purge_frontend_form_drafts", { p_limit: 500 }).abortSignal(signal),
  ]);
  const failures: string[] = [];
  if (swept.status === "rejected" || swept.value.error) failures.push("retention_sweep");
  if (drafts.status === "rejected" || drafts.value.error) failures.push("draft_purge");

  const context: RunContext = {
    service,
    storage,
    limits,
    budget,
    signal,
    leaseUsable: (leaseUntil) => Date.parse(leaseUntil) - now() >= limits.leaseMarginMs,
    elapsed: () => now() - started,
  };
  const evidence = await cleanEvidence(context);
  const media = await cleanMedia(context);
  if (evidence.claimFailed) failures.push("evidence_claim");
  if (media.claimFailed) failures.push("media_claim");

  // Counts only: no keys, identifiers or account data. Warn level whenever
  // the owner should look: failures, slow claims, storage trouble, retries.
  const alerts = [
    ...failures,
    ...(media.claimMs > limits.slowClaimMs ? ["slow_claim"] : []),
    ...(media.batchFallback ? ["batch_fallback"] : []),
    ...(media.storageBusy ? ["storage_busy"] : []),
    ...(media.failed + evidence.failed > 0 ? ["objects_retrying"] : []),
  ];
  (alerts.length > 0 ? log.warn : log.info)("Storage cleanup run", {
    alerts,
    media: {
      claimed: media.claimed,
      deleted: media.deleted,
      failed: media.failed,
      deferred: media.deferred,
      rounds: media.rounds,
      backlog: media.drained ? "drained" : "remaining",
      batchFallback: media.batchFallback,
      claimMs: media.claimMs,
    },
    evidence: { claimed: evidence.claimed, deleted: evidence.deleted, failed: evidence.failed },
    subrequests: budget.used,
    durationMs: now() - started,
  });
  if (failures.length > 0) throw new Error("Storage cleanup run was incomplete");
  return {
    claimed: media.claimed + evidence.claimed,
    deleted: media.deleted + evidence.deleted,
    retrying: media.failed + media.deferred + evidence.failed,
    backlog: media.drained ? ("drained" as const) : ("remaining" as const),
  };
}

async function cleanEvidence({
  service,
  storage,
  limits,
  budget,
  signal,
  leaseUsable,
}: RunContext) {
  const result = { claimed: 0, deleted: 0, failed: 0, claimFailed: false };
  // One claim, then a delete and an acknowledgement per artifact.
  const limit = Math.min(limits.evidenceClaim, Math.floor((budget.remaining - 1) / 2));
  if (limit < 1 || signal.aborted) return result;
  budget.take(1);
  let claimed;
  try {
    claimed = await service.rpc("claim_evidence_cleanup", { p_limit: limit }).abortSignal(signal);
  } catch {
    claimed = null;
  }
  // Strict and complete before any deletion: one unexpected row stops it.
  const parsed = z.array(evidenceRow).max(limit).safeParse(claimed?.data);
  if (!claimed || claimed.error || !parsed.success) {
    result.claimFailed = true;
    return result;
  }
  const rows = parsed.data;
  result.claimed = rows.length;
  const usable = rows.filter((row) => leaseUsable(row.lease_until));
  result.failed += rows.length - usable.length;
  budget.take(usable.length * 2);
  await Promise.all(
    usable.map(async (row) => {
      try {
        await storage.deleteOne(
          process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
          row.object_key,
          signal
        );
        const marked = await service
          .rpc("mark_evidence_deleted", {
            p_artifact: row.artifact_id,
            p_claim_token: row.claim_token,
          })
          .abortSignal(signal);
        if (marked.error || marked.data !== true) result.failed++;
        else result.deleted++;
      } catch {
        result.failed++;
      }
    })
  );
  return result;
}

/**
 * Claims, deletes and acknowledges media in rounds until the queue is empty,
 * the budget is spent, the time limit passes or a claim fails or is slow.
 * Each round deletes every claimed key with one batch request. If storage
 * refuses that request, the run switches to one request per key for what is
 * left of its budget (deleting a missing object is harmless) and sizes later
 * claims for that cost. If storage is busy, the run stops sending and leaves
 * the rest for the next run. Rows it cannot finish keep their claim and are
 * claimed again after the lease ends.
 */
async function cleanMedia({
  service,
  storage,
  limits,
  budget,
  signal,
  leaseUsable,
  elapsed,
}: RunContext) {
  const bucket = process.env.R2_PUBLIC_BUCKET || "verifymzansi-public";
  const result = {
    claimed: 0,
    deleted: 0,
    /** Tried this run and not finished: retried after the lease. */
    failed: 0,
    /** Claimed but not tried this run (no budget left, or storage busy). */
    deferred: 0,
    rounds: 0,
    drained: false,
    batchFallback: false,
    storageBusy: false,
    claimFailed: false,
    claimMs: 0,
  };
  while (result.rounds < limits.rounds && elapsed() < limits.runMs && !signal.aborted) {
    // Fixed cost: the claim (+ one batch delete). Per row: the acknowledgement
    // (+ one delete per key once storage has refused the batch request).
    const fixed = result.batchFallback ? 1 : 2;
    const perRow = result.batchFallback ? MEDIA_KEYS_PER_OBJECT + 1 : 1;
    const limit = Math.min(
      limits.mediaClaimPerRound,
      Math.floor((budget.remaining - fixed) / perRow)
    );
    if (limit < 1) break;
    result.rounds++;
    budget.take(1);
    const claimStarted = elapsed();
    let claimed;
    try {
      claimed = await service.rpc("claim_media_cleanup", { p_limit: limit }).abortSignal(signal);
    } catch {
      claimed = null;
    }
    // The claim checks every older ready object; its cost grows with live media.
    const claimMs = elapsed() - claimStarted;
    result.claimMs += claimMs;
    // Strict and complete before any deletion: one unexpected row stops the run.
    const parsed = z
      .array(mediaRow)
      .max(limit)
      .refine(
        (list) =>
          new Set(list.map((row) => row.object_id)).size === list.length &&
          new Set(list.map((row) => row.object_key)).size === list.length
      )
      .safeParse(claimed?.data);
    // A failed or timed-out claim ends this run's claims; the next run tries again.
    if (!claimed || claimed.error || !parsed.success) {
      result.claimFailed = true;
      break;
    }
    const rows = parsed.data;
    result.claimed += rows.length;
    if (rows.length < limit) result.drained = true;

    let pending = rows.filter((row) => leaseUsable(row.lease_until));
    result.failed += rows.length - pending.length;
    const deleted: MediaRow[] = [];
    if (!result.batchFallback && pending.length > 0) {
      budget.take(1);
      try {
        const unconfirmed = new Set(
          await storage.deleteMany(bucket, pending.flatMap(mediaKeys), signal)
        );
        for (const row of pending) {
          if (mediaKeys(row).some((key) => unconfirmed.has(key))) result.failed++;
          else deleted.push(row);
        }
        pending = [];
      } catch (error) {
        if (retryLater(error) || signal.aborted) {
          result.storageBusy = true;
          result.failed += pending.length;
          pending = [];
        } else {
          result.batchFallback = true;
        }
      }
    }
    if (pending.length > 0) {
      // One request per key, and room kept for each row's acknowledgement.
      const affordable: MediaRow[] = [];
      for (const row of pending) {
        if (budget.remaining - affordable.length < MEDIA_KEYS_PER_OBJECT + 1) break;
        budget.take(MEDIA_KEYS_PER_OBJECT);
        affordable.push(row);
      }
      result.deferred += pending.length - affordable.length;
      await Promise.all(
        affordable.map(async (row) => {
          const outcomes = await Promise.allSettled(
            mediaKeys(row).map((key) => storage.deleteOne(bucket, key, signal))
          );
          if (outcomes.every((outcome) => outcome.status === "fulfilled")) deleted.push(row);
          else {
            result.failed++;
            if (
              outcomes.some(
                (outcome) => outcome.status === "rejected" && retryLater(outcome.reason)
              )
            )
              result.storageBusy = true;
          }
        })
      );
    }

    budget.take(deleted.length);
    await Promise.all(
      deleted.map(async (row) => {
        try {
          const marked = await service
            .rpc("mark_media_deleted", {
              p_object_id: row.object_id,
              p_claim_token: row.claim_token,
            })
            .abortSignal(signal);
          if (marked.error || marked.data !== true) result.failed++;
          else result.deleted++;
        } catch {
          result.failed++;
        }
      })
    );
    if (result.drained || result.storageBusy || claimMs > limits.slowClaimMs) break;
  }
  return result;
}
