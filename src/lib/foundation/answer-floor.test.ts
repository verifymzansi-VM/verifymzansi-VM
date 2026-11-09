/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdAnswer } from "./answer-floor";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Whether the hold has finished after `ms` more milliseconds. */
async function settledAfter(hold: Promise<void>, ms: number) {
  let done = false;
  void hold.then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(ms);
  return done;
}

describe("holding an answer for a minimum time", () => {
  it("waits until the floor has passed since the start", async () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => array);
    const start = Date.now();
    const hold = holdAnswer(start, { floorMs: 3000, jitterMs: 0 });
    expect(await settledAfter(hold, 2999)).toBe(false);
    expect(await settledAfter(hold, 1)).toBe(true);
  });

  it("counts time already spent towards the floor", async () => {
    const start = Date.now() - 2500;
    expect(await settledAfter(holdAnswer(start, { floorMs: 3000, jitterMs: 0 }), 500)).toBe(true);
  });

  it("never delays an answer that already took longer than the floor", async () => {
    const start = Date.now() - 5000;
    expect(await settledAfter(holdAnswer(start, { floorMs: 3000, jitterMs: 1000 }), 0)).toBe(true);
  });

  it("adds a random extra wait of at most the jitter", async () => {
    const waits: number[] = [];
    for (const random of [0, 250, 1000, 1001, 4_294_967_295]) {
      vi.spyOn(crypto, "getRandomValues").mockImplementationOnce((array) => {
        (array as Uint32Array)[0] = random;
        return array;
      });
      const start = Date.now();
      const hold = holdAnswer(start, { floorMs: 100, jitterMs: 1000 });
      let waited = 0;
      while (!(await settledAfter(hold, 50))) waited += 50;
      waits.push(waited + 50);
    }
    // random % 1001 extra: 0, 250, 1000, 0, 4294967295 % 1001.
    const expected = [0, 250, 1000, 0, 4_294_967_295 % 1001].map(
      (extra) => Math.ceil((100 + extra) / 50) * 50
    );
    expect(waits).toEqual(expected);
    for (const wait of waits) expect(wait).toBeLessThanOrEqual(1100 + 50);
  });
});
