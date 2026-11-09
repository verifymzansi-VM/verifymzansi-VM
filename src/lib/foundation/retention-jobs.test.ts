/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import { CLEANUP_LIMITS, runFoundationRetention, type CleanupStorage } from "./retention-jobs";
vi.mock("server-only", () => ({}));
vi.mock("../services/storage", () => ({
  deleteFromR2: vi.fn(),
  deleteManyFromR2: vi.fn(),
  R2_DELETE_BATCH_LIMIT: 1000,
}));

const LEASE_MS = 5 * 60 * 1000;
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const variants = (key: string) => [
  key,
  `${key}.w400.webp`,
  `${key}.w800.webp`,
  `${key}.w1600.webp`,
];

type StoredObject = {
  id: string;
  key: string;
  inUse: boolean;
  state: "ready" | "cleanup_required" | "deleted";
  token?: string;
  leaseUntil?: number;
  acknowledged: number;
};
type Artifact = Omit<StoredObject, "inUse">;

/**
 * Stand-in for the SQL claim contract (claim_media_cleanup and friends):
 * claims never return objects in use, every claim gets a fresh token and a
 * 5-minute lease, and an acknowledgement needs the current token within the
 * lease. Storage holds every key, so a test can see what was deleted.
 */
function createWorld(
  options: { media?: number; inUse?: number[]; evidence?: number; clockStep?: number } = {}
) {
  const clock = { at: Date.parse("2026-11-09T10:00:00Z") };
  const now = () => {
    const at = clock.at;
    clock.at += options.clockStep ?? 0;
    return at;
  };
  const objects: StoredObject[] = Array.from({ length: options.media ?? 0 }, (_, i) => ({
    id: uuid(i + 1),
    key: `media/${uuid(i + 1)}`,
    inUse: options.inUse?.includes(i + 1) ?? false,
    state: "ready",
    acknowledged: 0,
  }));
  const artifacts: Artifact[] = Array.from({ length: options.evidence ?? 0 }, (_, i) => ({
    id: uuid(5000 + i),
    key: `evidence/${uuid(9000)}/${uuid(5000 + i)}`,
    state: "ready",
    acknowledged: 0,
  }));
  const stored = new Set([
    ...objects.flatMap((o) => variants(o.key)),
    ...artifacts.map((a) => a.key),
  ]);
  let tokens = 0;
  const claimable = (o: StoredObject | Artifact) =>
    o.state === "ready" || (o.state === "cleanup_required" && (o.leaseUntil ?? 0) <= clock.at);
  const claim = <T extends StoredObject | Artifact>(rows: T[], limit: number) =>
    rows
      .filter((o) => !("inUse" in o && o.inUse) && claimable(o))
      .slice(0, limit)
      .map((o) => {
        o.state = "cleanup_required";
        o.token = uuid(100000 + ++tokens);
        o.leaseUntil = clock.at + LEASE_MS;
        return o;
      });
  const acknowledge = (o: StoredObject | Artifact | undefined, token: string) => {
    if (o?.state === "deleted" && o.token === token) return { data: true, error: null };
    if (!o || o.state !== "cleanup_required" || o.token !== token || o.leaseUntil! <= clock.at)
      return { data: null, error: { message: "object is not awaiting deletion" } };
    o.state = "deleted";
    o.acknowledged++;
    return { data: true, error: null };
  };
  const overrides: Record<string, (args: Record<string, unknown>) => unknown> = {};
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (overrides[name]) return overrides[name](args);
    switch (name) {
      case "run_retention":
      case "purge_frontend_form_drafts":
        return { data: {}, error: null };
      case "claim_media_cleanup":
        return {
          data: claim(objects, args.p_limit as number).map((o) => ({
            object_id: o.id,
            object_key: o.key,
            claim_token: o.token,
            lease_until: new Date(o.leaseUntil!).toISOString(),
          })),
          error: null,
        };
      case "claim_evidence_cleanup":
        return {
          data: claim(artifacts, args.p_limit as number).map((a) => ({
            artifact_id: a.id,
            object_key: a.key,
            claim_token: a.token,
            lease_until: new Date(a.leaseUntil!).toISOString(),
          })),
          error: null,
        };
      case "mark_media_deleted":
        return acknowledge(
          objects.find((o) => o.id === args.p_object_id),
          args.p_claim_token as string
        );
      case "mark_evidence_deleted":
        return acknowledge(
          artifacts.find((a) => a.id === args.p_artifact),
          args.p_claim_token as string
        );
    }
    throw new Error(`unexpected command ${name}`);
  });
  const storage = {
    deleteOne: vi.fn<CleanupStorage["deleteOne"]>(async (_bucket, key) => {
      stored.delete(key);
    }),
    deleteMany: vi.fn<CleanupStorage["deleteMany"]>(async (_bucket, keys) => {
      for (const key of keys) stored.delete(key);
      return [];
    }),
  };
  const subrequests = () =>
    rpc.mock.calls.length +
    storage.deleteOne.mock.calls.length +
    storage.deleteMany.mock.calls.length;
  const run = (limits?: NonNullable<Parameters<typeof runFoundationRetention>[2]>["limits"]) =>
    runFoundationRetention({ rpc } as unknown as FoundationServiceApi, storage, { now, limits });
  return { clock, objects, artifacts, stored, rpc, storage, overrides, subrequests, run };
}

const info = vi.spyOn(console, "info");
beforeEach(() => {
  vi.clearAllMocks();
  info.mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.R2_PUBLIC_BUCKET;
  delete process.env.R2_PRIVATE_BUCKET;
});

it("deletes a claimed object and its display variants in one batch request, then acknowledges it with its claim token", async () => {
  const world = createWorld({ media: 1, evidence: 1 });
  expect(await world.run()).toEqual({ claimed: 2, deleted: 2, retrying: 0, backlog: "drained" });
  const [object] = world.objects;
  expect(world.storage.deleteMany).toHaveBeenCalledExactlyOnceWith(
    "verifymzansi-public",
    variants(object!.key)
  );
  expect(world.storage.deleteOne).toHaveBeenCalledExactlyOnceWith(
    "verifymzansi-private",
    world.artifacts[0]!.key
  );
  expect(world.rpc).toHaveBeenCalledWith("mark_media_deleted", {
    p_object_id: object!.id,
    p_claim_token: object!.token,
  });
  expect(world.rpc).toHaveBeenCalledWith("purge_frontend_form_drafts", { p_limit: 500 });
  expect(world.rpc).toHaveBeenCalledWith("run_retention", { p_limit: 100 });
  expect(world.stored.size).toBe(0);
});

it("uses the configured buckets", async () => {
  process.env.R2_PUBLIC_BUCKET = "public-fixture";
  process.env.R2_PRIVATE_BUCKET = "private-fixture";
  const world = createWorld({ media: 1, evidence: 1 });
  await world.run();
  expect(world.storage.deleteMany.mock.calls[0]![0]).toBe("public-fixture");
  expect(world.storage.deleteOne.mock.calls[0]![0]).toBe("private-fixture");
});

it("stays within 40 subrequests per run and reports the backlog that remains", async () => {
  const world = createWorld({ media: 500, evidence: 10 });
  const first = await world.run();
  expect(world.subrequests()).toBeLessThanOrEqual(CLEANUP_LIMITS.subrequests);
  // 40 - 2 sweeps - 9 evidence (claim of 4, delete + acknowledgement each)
  // - claim - batch delete = 27 acknowledgements.
  expect(world.rpc).toHaveBeenCalledWith("claim_evidence_cleanup", { p_limit: 4 });
  expect(world.rpc).toHaveBeenCalledWith("claim_media_cleanup", { p_limit: 27 });
  expect(world.storage.deleteMany).toHaveBeenCalledOnce();
  expect(first).toEqual({ claimed: 31, deleted: 31, retrying: 0, backlog: "remaining" });

  let runs = 1;
  while ((await world.run()).backlog === "remaining") runs++;
  expect(world.objects.every((o) => o.state === "deleted" && o.acknowledged === 1)).toBe(true);
  expect(world.stored.size).toBe(0);
  // 500 objects at 27+ per run: about 19 runs, i.e. under 2 hours at one run every 5 minutes.
  expect(runs).toBeLessThanOrEqual(19);
});

it("never spends more than the budget across every run of a long backlog", async () => {
  const world = createWorld({ media: 200, evidence: 30 });
  for (let run = 0; run < 12; run++) {
    const before = world.subrequests();
    await world.run();
    expect(world.subrequests() - before).toBeLessThanOrEqual(CLEANUP_LIMITS.subrequests);
  }
});

it("claims further rounds until the queue is empty when the budget allows", async () => {
  const world = createWorld({ media: 35 });
  expect(await world.run({ subrequests: 200, mediaClaimPerRound: 10 })).toMatchObject({
    claimed: 35,
    deleted: 35,
    backlog: "drained",
  });
  expect(world.rpc.mock.calls.filter(([name]) => name === "claim_media_cleanup")).toEqual([
    ["claim_media_cleanup", { p_limit: 10 }],
    ["claim_media_cleanup", { p_limit: 10 }],
    ["claim_media_cleanup", { p_limit: 10 }],
    ["claim_media_cleanup", { p_limit: 10 }],
  ]);
  expect(world.storage.deleteMany).toHaveBeenCalledTimes(4);
  expect(world.stored.size).toBe(0);
});

it("starts no round after the time limit but finishes the round it started", async () => {
  // Every clock read moves 3 s on, so the limit passes partway through.
  const world = createWorld({ media: 1000, clockStep: 3000 });
  const result = await world.run({ subrequests: 1000, mediaClaimPerRound: 5 });
  const claims = world.rpc.mock.calls.filter(([name]) => name === "claim_media_cleanup").length;
  expect(claims).toBeGreaterThan(0);
  expect(claims).toBeLessThan(CLEANUP_LIMITS.rounds);
  expect(result).toMatchObject({ claimed: claims * 5, backlog: "remaining" });
  // Rows inside a claimed round are not abandoned because time ran out.
  expect(result.deleted + result.retrying).toBe(claims * 5);
});

it("stops after the round limit even with budget and time to spare", async () => {
  const world = createWorld({ media: 1000 });
  await world.run({ subrequests: 1000, mediaClaimPerRound: 5 });
  expect(world.rpc.mock.calls.filter(([name]) => name === "claim_media_cleanup")).toHaveLength(
    CLEANUP_LIMITS.rounds
  );
});

it("never deletes or acknowledges an object that is still in use", async () => {
  const inUse = [1, 2, 3, 10, 27, 28, 40];
  const world = createWorld({ media: 60, inUse });
  while ((await world.run()).backlog === "remaining");
  const requested = new Set([
    ...world.storage.deleteMany.mock.calls.flatMap(([, keys]) => keys),
    ...world.storage.deleteOne.mock.calls.map(([, key]) => key),
  ]);
  for (const object of world.objects) {
    const keys = variants(object.key);
    if (object.inUse) {
      expect(object.state).toBe("ready");
      expect(keys.some((key) => requested.has(key))).toBe(false);
      expect(keys.every((key) => world.stored.has(key))).toBe(true);
    } else {
      expect(object.state).toBe("deleted");
    }
  }
  expect(world.rpc.mock.calls.filter(([name]) => name === "mark_media_deleted")).toHaveLength(53);
});

it("acknowledges only objects whose every key storage confirmed, and retries the rest later", async () => {
  const world = createWorld({ media: 3 });
  const unconfirmed = `${world.objects[1]!.key}.w800.webp`;
  world.storage.deleteMany.mockImplementationOnce(async (_bucket, keys) => {
    for (const key of keys) if (key !== unconfirmed) world.stored.delete(key);
    return [unconfirmed];
  });
  expect(await world.run()).toEqual({ claimed: 3, deleted: 2, retrying: 1, backlog: "drained" });
  expect(world.objects.map((o) => o.state)).toEqual(["deleted", "cleanup_required", "deleted"]);
  const firstToken = world.objects[1]!.token;

  // Inside the lease nothing is claimed again; after it, a new claim finishes the object.
  expect(await world.run()).toMatchObject({ claimed: 0, deleted: 0 });
  world.clock.at += LEASE_MS;
  expect(await world.run()).toEqual({ claimed: 1, deleted: 1, retrying: 0, backlog: "drained" });
  expect(world.objects[1]!.token).not.toBe(firstToken);
  expect(world.objects.every((o) => o.acknowledged === 1)).toBe(true);
  expect(world.stored.size).toBe(0);
});

it("retries an object whose acknowledgement failed without counting it twice", async () => {
  const world = createWorld({ media: 2 });
  let failures = 0;
  world.overrides.mark_media_deleted = () => {
    if (failures++ === 0) throw new Error("network unavailable");
    delete world.overrides.mark_media_deleted;
    return { data: false, error: null };
  };
  expect(await world.run()).toEqual({ claimed: 2, deleted: 0, retrying: 2, backlog: "drained" });
  world.clock.at += LEASE_MS;
  // Deleting an already deleted key again is harmless; the new claim acknowledges once.
  expect(await world.run()).toEqual({ claimed: 2, deleted: 2, retrying: 0, backlog: "drained" });
  expect(world.objects.every((o) => o.state === "deleted" && o.acknowledged === 1)).toBe(true);
});

it("does not touch rows whose lease is too close to its end", async () => {
  const world = createWorld({ media: 2 });
  let claims = 0;
  world.overrides.claim_media_cleanup = () => {
    if (claims++ > 0) return { data: [], error: null };
    return {
      data: world.objects.map((o, index) => ({
        object_id: o.id,
        object_key: o.key,
        claim_token: uuid(777 + index),
        lease_until: new Date(world.clock.at + (index === 0 ? 59_000 : 0)).toISOString(),
      })),
      error: null,
    };
  };
  // The first round is full, so a second claim runs and finds nothing left.
  expect(await world.run({ mediaClaimPerRound: 2 })).toEqual({
    claimed: 2,
    deleted: 0,
    retrying: 2,
    backlog: "drained",
  });
  expect(world.storage.deleteMany).not.toHaveBeenCalled();
  expect(world.rpc.mock.calls.some(([name]) => name === "mark_media_deleted")).toBe(false);
  expect(world.stored.size).toBe(8);
});

it("falls back to one request per key when the batch request fails, inside the same budget", async () => {
  const world = createWorld({ media: 100 });
  world.storage.deleteMany.mockRejectedValue(new Error("batch delete unavailable"));
  const result = await world.run();
  expect(world.subrequests()).toBeLessThanOrEqual(CLEANUP_LIMITS.subrequests);
  // 40 - 2 sweeps - evidence claim - media claim - failed batch = 35:
  // seven objects at four deletes plus an acknowledgement each.
  expect(world.storage.deleteOne).toHaveBeenCalledTimes(28);
  expect(result).toEqual({ claimed: 35, deleted: 7, retrying: 28, backlog: "remaining" });
  expect(info.mock.calls.at(-1)![0]).toMatch(/"batchFallback":true/);

  // Later runs try the batch again first and keep making progress either way.
  world.clock.at += LEASE_MS;
  await world.run();
  expect(world.storage.deleteMany).toHaveBeenCalledTimes(2);
  expect(world.objects.filter((o) => o.state === "deleted")).toHaveLength(14);
});

it("does not acknowledge an object if any single delete fails during the fallback", async () => {
  const world = createWorld({ media: 2 });
  world.storage.deleteMany.mockRejectedValue(new Error("batch delete unavailable"));
  world.storage.deleteOne.mockImplementation(async (_bucket, key) => {
    if (key === `${world.objects[0]!.key}.w400.webp`) throw new Error("storage unavailable");
    world.stored.delete(key);
  });
  expect(await world.run()).toEqual({ claimed: 2, deleted: 1, retrying: 1, backlog: "drained" });
  expect(world.objects.map((o) => o.state)).toEqual(["cleanup_required", "deleted"]);
});

it("does not acknowledge evidence whose deletion failed", async () => {
  const world = createWorld({ evidence: 2 });
  world.storage.deleteOne.mockRejectedValue(new Error("storage unavailable"));
  expect(await world.run()).toEqual({ claimed: 2, deleted: 0, retrying: 2, backlog: "drained" });
  expect(world.rpc.mock.calls.some(([name]) => name.startsWith("mark_"))).toBe(false);
});

it("two overlapping runs never delete or acknowledge the same object", async () => {
  const world = createWorld({ media: 50 });
  await Promise.all([world.run(), world.run()]);
  const batches = world.storage.deleteMany.mock.calls.map(([, keys]) => keys);
  expect(batches).toHaveLength(2);
  const [first, second] = batches.map((keys) => new Set(keys));
  expect([...first!].some((key) => second!.has(key))).toBe(false);
  expect(world.objects.filter((o) => o.acknowledged > 1)).toEqual([]);
});

it("refuses unbounded or unrecognised object paths before any R2 deletion", async () => {
  const world = createWorld({ media: 1 });
  world.overrides.claim_media_cleanup = () => ({
    data: [
      {
        object_id: uuid(1),
        object_key: "old-archive/private-document",
        claim_token: uuid(2),
        lease_until: new Date(world.clock.at + LEASE_MS).toISOString(),
      },
    ],
    error: null,
  });
  await expect(world.run()).rejects.toThrow();
  expect(world.storage.deleteMany).not.toHaveBeenCalled();
  expect(world.storage.deleteOne).not.toHaveBeenCalled();
});

it.each([
  ["object", (n: number) => ({ object_id: uuid(1), object_key: `media/${uuid(n)}` })],
  ["key", (n: number) => ({ object_id: uuid(n), object_key: `media/${uuid(1)}` })],
])("refuses a claim that repeats an %s before any deletion", async (_, row) => {
  const world = createWorld({ media: 2 });
  world.overrides.claim_media_cleanup = () => ({
    data: [1, 2].map((n) => ({
      ...row(n),
      claim_token: uuid(3),
      lease_until: new Date(world.clock.at + LEASE_MS).toISOString(),
    })),
    error: null,
  });
  await expect(world.run()).rejects.toThrow();
  expect(world.storage.deleteMany).not.toHaveBeenCalled();
  expect(world.storage.deleteOne).not.toHaveBeenCalled();
});

it("refuses a claim that returns more rows than it asked for before any deletion", async () => {
  const world = createWorld({ media: 40 });
  world.overrides.claim_media_cleanup = (args) => ({
    data: world.objects.slice(0, (args.p_limit as number) + 1).map((o) => ({
      object_id: o.id,
      object_key: o.key,
      claim_token: uuid(3),
      lease_until: new Date(world.clock.at + LEASE_MS).toISOString(),
    })),
    error: null,
  });
  await expect(world.run()).rejects.toThrow();
  expect(world.storage.deleteMany).not.toHaveBeenCalled();
});

it("refuses an evidence claim larger than it asked for before any deletion", async () => {
  const world = createWorld({ evidence: 5, media: 1 });
  world.overrides.claim_evidence_cleanup = (args) => ({
    data: world.artifacts.slice(0, (args.p_limit as number) + 1).map((a) => ({
      artifact_id: a.id,
      object_key: a.key,
      claim_token: uuid(4),
      lease_until: new Date(world.clock.at + LEASE_MS).toISOString(),
    })),
    error: null,
  });
  await expect(world.run()).rejects.toThrow();
  expect(world.storage.deleteOne).not.toHaveBeenCalled();
  expect(world.storage.deleteMany).not.toHaveBeenCalled();
});

it("fails the run when a claim fails, after finishing the work it could do", async () => {
  const world = createWorld({ evidence: 1, media: 1 });
  world.overrides.claim_media_cleanup = () => ({ data: null, error: { message: "unavailable" } });
  await expect(world.run()).rejects.toThrow("Storage cleanup could not be claimed");
  expect(world.artifacts[0]!.state).toBe("deleted");
  expect(world.storage.deleteMany).not.toHaveBeenCalled();
  expect(info).toHaveBeenCalledOnce();
});

it("stops before any claim when the retention sweep fails", async () => {
  const world = createWorld({ media: 1 });
  world.overrides.run_retention = () => ({ data: null, error: { message: "unavailable" } });
  await expect(world.run()).rejects.toThrow("Retention transactions could not be completed");
  expect(world.rpc.mock.calls.some(([name]) => name.startsWith("claim_"))).toBe(false);
});

it("logs counts only, never keys or identifiers", async () => {
  const world = createWorld({ media: 100, evidence: 1 });
  await world.run();
  expect(info).toHaveBeenCalledOnce();
  const line = String(info.mock.calls[0]![0]);
  expect(line).toContain("Storage cleanup run");
  expect(line).toContain('"backlog":"remaining"');
  expect(line).toContain('"subrequests":40');
  expect(line).toMatch(/"claimMs":\d+/);
  expect(line).not.toMatch(/media\/|evidence\/|[0-9a-f]{8}-[0-9a-f]{4}-/);
});

it("refuses limits a single batch request or the claim commands cannot honour", async () => {
  const world = createWorld({ media: 1 });
  for (const limits of [
    { mediaClaimPerRound: 251 },
    { evidenceClaim: 101 },
    { subrequests: 0 },
    { runMs: 1.5 },
  ])
    await expect(world.run(limits)).rejects.toThrow("Invalid storage cleanup limits");
  expect(world.rpc).not.toHaveBeenCalled();
});
