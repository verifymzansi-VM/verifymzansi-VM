// Worker size budget. Cloudflare refuses a Worker whose compressed upload is
// over 10 MB (paid plan); past that point no release, not even an urgent
// security fix, can be published. Units are decimal megabytes (1 MB =
// 1,000,000 bytes), the stricter reading of the limit.
const WORKER_LIMIT_BYTES = 10_000_000;
export const WORKER_BUDGET_BYTES = 9_500_000;
/** Below this headroom, slimming the Worker becomes the next priority. */
const WORKER_HEADROOM_WARNING_BYTES = 500_000;

/** Reads "Total Upload: 42198.71 KiB / gzip: 9020.41 KiB" from Wrangler output. */
export function parseWranglerUpload(output) {
  const text = String(output).replace(/\u001b\[[0-9;]*m/g, "");
  const match = /Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/.exec(text);
  if (!match) return null;
  return {
    totalBytes: Math.round(Number(match[1]) * 1024),
    gzipBytes: Math.round(Number(match[2]) * 1024),
  };
}

const megabytes = (bytes) => (bytes / 1_000_000).toFixed(2);

export function evaluateWorkerSize(
  gzipBytes,
  { budgetBytes = WORKER_BUDGET_BYTES, limitBytes = WORKER_LIMIT_BYTES } = {}
) {
  if (!Number.isFinite(gzipBytes) || gzipBytes <= 0) {
    throw new Error("Worker gzip size must be a positive number of bytes");
  }
  const headroomBytes = limitBytes - gzipBytes;
  const overBudget = gzipBytes > budgetBytes;
  const lowHeadroom = headroomBytes < WORKER_HEADROOM_WARNING_BYTES;
  return {
    ok: !overBudget,
    lowHeadroom,
    headroomBytes,
    summary: `worker gzip = ${megabytes(gzipBytes)} MB, budget ${megabytes(budgetBytes)} MB (Cloudflare limit ${megabytes(limitBytes)} MB, headroom ${megabytes(headroomBytes)} MB)`,
  };
}

/** Optional override for negative tests: WORKER_GZIP_BUDGET_BYTES=<positive integer>. */
export function budgetFromEnvironment(environment = process.env) {
  const raw = environment.WORKER_GZIP_BUDGET_BYTES;
  if (raw === undefined || raw === "") return WORKER_BUDGET_BYTES;
  if (!/^[1-9]\d*$/.test(raw))
    throw new Error("WORKER_GZIP_BUDGET_BYTES must be a positive integer");
  const value = Number(raw);
  if (value > WORKER_BUDGET_BYTES) {
    throw new Error("WORKER_GZIP_BUDGET_BYTES may only lower the budget");
  }
  return value;
}
