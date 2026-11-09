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
 * - subrequests: Workers Free allows 50 subrequests per invocation (Paid
 *   1,000). Every database call and every R2 S3-API call is one; cleanup
 *   storage calls make no SDK retries, so the count is exact. 40 leaves 10
 *   for the platform (error reporting, framework).
 * - mediaClaimPerRound: 100 objects x 4 keys = 400 keys, so one round needs
 *   one R2 batch request (limit 1,000 keys). The 40 budget allows about 27
 *   objects per run; the cap matters only if the budget is raised.
 * - runMs: no new round starts after 20 s; the cron Worker gives up on the
 *   request at 45 s.
 * - leaseMarginMs: claims hold a 5-minute lease. A row with less than a
 *   minute left is not touched; it is claimed again after the lease ends.
 */
type CleanupLimits = Record<
  "subrequests" | "evidenceClaim" | "mediaClaimPerRound" | "rounds" | "runMs" | "leaseMarginMs",
  number
>;
export const CLEANUP_LIMITS: Readonly<CleanupLimits> = Object.freeze({
  subrequests: 40,
  evidenceClaim: 4,
  mediaClaimPerRound: 100,
  rounds: 8,
  runMs: 20_000,
  leaseMarginMs: 60_000,
});

/** The original and its display variants: deleted together, acknowledged once. */
const MEDIA_KEYS_PER_OBJECT = 1 + VARIANT_WIDTHS.length;

function checkedLimits(override: Partial<CleanupLimits>): CleanupLimits {
  const limits = { ...CLEANUP_LIMITS, ...override };
  if (
    !Object.values(limits).every((value) => Number.isSafeInteger(value) && value > 0) ||
    limits.mediaClaimPerRound * MEDIA_KEYS_PER_OBJECT > R2_DELETE_BATCH_LIMIT ||
    limits.evidenceClaim > 100 ||
    limits.mediaClaimPerRound > 500
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

/** Storage calls the cleanup makes; each is exactly one Worker subrequest. */
export type CleanupStorage = {
  deleteOne(bucket: string, key: string): Promise<void>;
  /** Returns the keys storage did not confirm as deleted. */
  deleteMany(bucket: string, keys: string[]): Promise<string[]>;
};
const r2Storage: CleanupStorage = {
  deleteOne: (bucket, key) => deleteFromR2(bucket, key, "single-attempt"),
  deleteMany: deleteManyFromR2,
};

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
  /** False when a claim lease is too close to its end to start deleting. */
  leaseUsable(leaseUntil: string): boolean;
  elapsed(): number;
};

export async function runFoundationRetention(
  service: FoundationServiceApi = createFoundationServiceApi(),
  storage: CleanupStorage = r2Storage,
  options: { now?: () => number; limits?: Partial<CleanupLimits> } = {}
) {
  const now = options.now ?? Date.now;
  const limits = checkedLimits(options.limits ?? {});
  const started = now();
  const budget = createBudget(limits.subrequests);
  budget.take(2);
  const [swept, drafts] = await Promise.all([
    service.rpc("run_retention", { p_limit: 100 }),
    service.rpc("purge_frontend_form_drafts", { p_limit: 500 }),
  ]);
  if (swept.error) throw new Error("Retention transactions could not be completed");
  if (drafts.error) throw new Error("Expired form drafts could not be removed");

  const context: RunContext = {
    service,
    storage,
    limits,
    budget,
    leaseUsable: (leaseUntil) => Date.parse(leaseUntil) - now() >= limits.leaseMarginMs,
    elapsed: () => now() - started,
  };
  const evidence = await cleanEvidence(context);
  const media = await cleanMedia(context);

  // Counts only: no keys, identifiers or account data.
  log.info("Storage cleanup run", {
    media: {
      claimed: media.claimed,
      deleted: media.deleted,
      retrying: media.retrying,
      rounds: media.rounds,
      backlog: media.drained ? "drained" : "remaining",
      batchFallback: media.batchFallback,
      claimMs: media.claimMs,
    },
    evidence: { claimed: evidence.claimed, deleted: evidence.deleted, retrying: evidence.retrying },
    subrequests: budget.used,
    durationMs: now() - started,
  });
  if (media.claimFailed || evidence.claimFailed)
    throw new Error("Storage cleanup could not be claimed");
  return {
    claimed: media.claimed + evidence.claimed,
    deleted: media.deleted + evidence.deleted,
    retrying: media.retrying + evidence.retrying,
    backlog: media.drained ? ("drained" as const) : ("remaining" as const),
  };
}

async function cleanEvidence({ service, storage, limits, budget, leaseUsable }: RunContext) {
  const result = { claimed: 0, deleted: 0, retrying: 0, claimFailed: false };
  // One claim, then a delete and an acknowledgement per artifact.
  const limit = Math.min(limits.evidenceClaim, Math.floor((budget.remaining - 1) / 2));
  if (limit < 1) return result;
  budget.take(1);
  const claimed = await service.rpc("claim_evidence_cleanup", { p_limit: limit });
  if (claimed.error) {
    result.claimFailed = true;
    return result;
  }
  const rows = z.array(evidenceRow).max(limit).parse(claimed.data);
  result.claimed = rows.length;
  const usable = rows.filter((row) => leaseUsable(row.lease_until));
  result.retrying += rows.length - usable.length;
  budget.take(usable.length * 2);
  await Promise.all(
    usable.map(async (row) => {
      try {
        await storage.deleteOne(
          process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
          row.object_key
        );
        const marked = await service.rpc("mark_evidence_deleted", {
          p_artifact: row.artifact_id,
          p_claim_token: row.claim_token,
        });
        if (marked.error || marked.data !== true) result.retrying++;
        else result.deleted++;
      } catch {
        result.retrying++;
      }
    })
  );
  return result;
}

/**
 * Claims, deletes and acknowledges media in rounds until the queue is empty,
 * the subrequest budget is spent or the time limit passes. Each round deletes
 * every claimed key with one batch request. If that request fails, the run
 * switches to one request per key for what is left of its budget (deleting a
 * missing object is harmless), so cleanup never stops entirely. Rows it cannot
 * finish keep their claim and are retried after the lease ends.
 */
async function cleanMedia({ service, storage, limits, budget, leaseUsable, elapsed }: RunContext) {
  const bucket = process.env.R2_PUBLIC_BUCKET || "verifymzansi-public";
  const result = {
    claimed: 0,
    deleted: 0,
    retrying: 0,
    rounds: 0,
    drained: false,
    batchFallback: false,
    claimFailed: false,
    claimMs: 0,
  };
  while (result.rounds < limits.rounds && elapsed() < limits.runMs) {
    // Fixed cost: the claim (+ one batch delete). Per row: the acknowledgement
    // (+ one delete per key once the batch request has failed).
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
    const claimed = await service.rpc("claim_media_cleanup", { p_limit: limit });
    // The claim checks every older ready object; watch its cost as media grows.
    result.claimMs += elapsed() - claimStarted;
    if (claimed.error) {
      result.claimFailed = true;
      break;
    }
    // Strict and complete before any deletion: one unexpected row stops the run.
    const rows = z
      .array(mediaRow)
      .max(limit)
      .refine(
        (list) =>
          new Set(list.map((row) => row.object_id)).size === list.length &&
          new Set(list.map((row) => row.object_key)).size === list.length
      )
      .parse(claimed.data);
    result.claimed += rows.length;
    if (rows.length < limit) result.drained = true;

    let pending = rows.filter((row) => leaseUsable(row.lease_until));
    result.retrying += rows.length - pending.length;
    const deleted: MediaRow[] = [];
    if (!result.batchFallback && pending.length > 0) {
      budget.take(1);
      try {
        const unconfirmed = new Set(await storage.deleteMany(bucket, pending.flatMap(mediaKeys)));
        for (const row of pending) {
          if (mediaKeys(row).some((key) => unconfirmed.has(key))) result.retrying++;
          else deleted.push(row);
        }
        pending = [];
      } catch {
        result.batchFallback = true;
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
      result.retrying += pending.length - affordable.length;
      await Promise.all(
        affordable.map(async (row) => {
          const outcomes = await Promise.allSettled(
            mediaKeys(row).map((key) => storage.deleteOne(bucket, key))
          );
          if (outcomes.every((outcome) => outcome.status === "fulfilled")) deleted.push(row);
          else result.retrying++;
        })
      );
    }

    budget.take(deleted.length);
    await Promise.all(
      deleted.map(async (row) => {
        try {
          const marked = await service.rpc("mark_media_deleted", {
            p_object_id: row.object_id,
            p_claim_token: row.claim_token,
          });
          if (marked.error || marked.data !== true) result.retrying++;
          else result.deleted++;
        } catch {
          result.retrying++;
        }
      })
    );
    if (result.drained) break;
  }
  return result;
}
