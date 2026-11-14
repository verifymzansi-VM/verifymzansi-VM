import "server-only";

import { createLogger } from "../utils/logger";

/**
 * A rough monthly count of Cloudflare Images transformations, so phone-sized
 * photo copies never use up the allowance that the safety re-encode of every
 * uploaded photo needs.
 *
 * Images Free includes 5,000 unique transformations per calendar month; past
 * that, new transformations fail with error 9422 until the next month and are
 * not charged (https://developers.cloudflare.com/images/pricing/). The
 * re-encode of every photo is one transformation and each copy is another, so
 * copies stop once PHOTO_COPY_BUDGET (60%) is counted, leaving the rest for
 * re-encodes.
 *
 * The count lives in the existing KV namespace OTP_RATE_LIMITS under its own
 * key per UTC month (no new service). KV reads can be up to about a minute
 * old and a key takes about one write per second, so the count is
 * approximate: uploads within the same minute can lose increments (it
 * undercounts, never overcounts). The 40% margin is for that; at this site's
 * volume (thousands a month, not per minute) the loss is small. A 9422 from
 * the re-encode sets the count to the whole allowance, so copies stop for the
 * rest of the month. Re-encodes of verification images are counted too.
 * When the count cannot be read on Workers, or is damaged, no copies are made
 * (re-encodes still run). Outside Workers (local development, tests, CI) sharp
 * does the work and there is no allowance, so copies are always allowed and
 * nothing is counted.
 */

export const IMAGES_FREE_MONTHLY_TRANSFORMATIONS = 5000;
export const PHOTO_COPY_BUDGET = Math.floor(IMAGES_FREE_MONTHLY_TRANSFORMATIONS * 0.6);

const KEY_PREFIX = "images-transformations:";
/** Long enough to outlive its month, short enough to clean itself up. */
const COUNTER_TTL_SECONDS = 40 * 24 * 60 * 60;

const log = createLogger("ImagesAllowance");

interface CounterStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

function isCounterStore(value: unknown): value is CounterStore {
  const store = value as { get?: unknown; put?: unknown } | null;
  return !!store && typeof store.get === "function" && typeof store.put === "function";
}

/** The counter key of the calendar month (UTC) that `now` falls in. */
export function imagesUsageKey(now: Date): string {
  return `${KEY_PREFIX}${now.toISOString().slice(0, 7)}`;
}

/** A damaged count reads as the whole allowance, so copies stop (fail closed). */
function parseCount(raw: string | null): number {
  const count = raw === null ? 0 : Number(raw);
  return Number.isSafeInteger(count) && count >= 0 ? count : IMAGES_FREE_MONTHLY_TRANSFORMATIONS;
}

/** null: not on Workers. undefined: on Workers without the KV binding. */
async function counterStore(): Promise<CounterStore | null | undefined> {
  let environment: Record<string, unknown>;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    environment = (await getCloudflareContext({ async: true })).env as Record<string, unknown>;
  } catch {
    return null;
  }
  return isCounterStore(environment.OTP_RATE_LIMITS) ? environment.OTP_RATE_LIMITS : undefined;
}

export interface ImagesAllowance {
  /** Whether `copies` more transformations still fit under the copy budget.
   * Reads the month's count on first use. */
  allowsCopies(copies: number): Promise<boolean>;
  /** Add transformations made by this request (saved by `save`). */
  add(transformations: number): void;
  /** Store this request's transformations with one write. Never throws. */
  save(): Promise<void>;
  /** The allowance is used up (error 9422): set the month's count to it, so
   * copies stop even if the count had lagged. Never throws. */
  markUsedUp(): Promise<void>;
}

const OUTSIDE_WORKERS: ImagesAllowance = {
  allowsCopies: async () => true,
  add: () => {},
  save: async () => {},
  markUsedUp: async () => {},
};

function failure(error: unknown) {
  return { error: error instanceof Error ? error.message : String(error) };
}

/** This month's count for one request. Never throws. */
export async function openImagesAllowance(now = new Date()): Promise<ImagesAllowance> {
  const store = await counterStore();
  if (store === null) return OUTSIDE_WORKERS;
  if (!store) log.warn("Images usage counter binding missing; photo copies skipped");
  const key = imagesUsageKey(now);
  let pending = 0;
  let counted: Promise<number | null> | undefined;
  const read = () =>
    (counted ??= store
      ? store.get(key).then(parseCount, (error: unknown) => {
          log.warn("Images usage count unavailable; photo copies skipped", failure(error));
          return null;
        })
      : Promise.resolve(null));
  const write = async (next: (latest: number) => number, what: string) => {
    if (!store) return;
    try {
      // Re-read just before writing; KV is eventually consistent, so the count
      // stays approximate (see above).
      const latest = parseCount(await store.get(key));
      await store.put(key, String(next(latest)), { expirationTtl: COUNTER_TTL_SECONDS });
    } catch (error) {
      log.warn(what, failure(error));
    }
  };
  return {
    async allowsCopies(copies) {
      const count = await read();
      if (count === null) return false;
      const allowed = count + pending + copies <= PHOTO_COPY_BUDGET;
      if (!allowed)
        log.warn("Photo copies paused: monthly Images budget for copies reached", {
          counted: count + pending,
          budget: PHOTO_COPY_BUDGET,
          allowance: IMAGES_FREE_MONTHLY_TRANSFORMATIONS,
        });
      return allowed;
    },
    add(transformations) {
      pending += transformations;
    },
    async save() {
      if (pending <= 0) return;
      const saving = pending;
      pending = 0;
      await write((latest) => latest + saving, "Images usage count not saved");
    },
    async markUsedUp() {
      await write(
        (latest) => Math.max(latest, IMAGES_FREE_MONTHLY_TRANSFORMATIONS),
        "Images usage count not marked used up"
      );
    },
  };
}

/** Count transformations made outside a photo upload (verification images). */
export async function recordImagesTransformations(transformations: number): Promise<void> {
  const allowance = await openImagesAllowance();
  allowance.add(transformations);
  await allowance.save();
}
