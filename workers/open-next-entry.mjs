import worker from "../.open-next/worker.js";
import { markStagingResponse } from "./staging-noindex.mjs";

export { DOQueueHandler } from "@opennextjs/cloudflare/durable-objects/queue";
export { DOShardedTagCache } from "@opennextjs/cloudflare/durable-objects/sharded-tag-cache";
export { BucketCachePurge } from "@opennextjs/cloudflare/durable-objects/bucket-cache-purge";
export { RateLimiterDO } from "./rate-limiter.ts";

// The staging copy (ENVIRONMENT "staging", M0.15b) must never be indexed:
// every response it sends says so. Production responses pass through unchanged.
const entry = {
  ...worker,
  async fetch(request, env, ctx) {
    return markStagingResponse(await worker.fetch(request, env, ctx), env);
  },
};

export default entry;
