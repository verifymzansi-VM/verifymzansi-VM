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

  /** Feeds these 16-bit values to the random source, one per draw. */
  function randomValues(...values: number[]) {
    const spy = vi.spyOn(crypto, "getRandomValues");
    for (const value of values)
      spy.mockImplementationOnce((array) => {
        (array as Uint16Array)[0] = value;
        return array;
      });
    return spy;
  }

  /** How long a hold with a 100 ms floor and 1000 ms jitter takes, in 50 ms steps. */
  async function heldFor() {
    const hold = holdAnswer(Date.now(), { floorMs: 100, jitterMs: 1000 });
    let waited = 50;
    while (!(await settledAfter(hold, 50))) waited += 50;
    return waited;
  }

  it("adds a random extra wait from 0 to the jitter, from 10 random bits", async () => {
    const waits: number[] = [];
    // The low 10 bits are used: 0, 250, 1000, and 1000 again from 0xfbe8.
    for (const value of [0, 250, 1000, 0xfbe8]) {
      randomValues(value);
      waits.push(await heldFor());
    }
    expect(waits).toEqual([100, 350, 1100, 1100]);
  });

  it("draws again instead of folding values above the jitter onto low ones", async () => {
    // 1001 and 1023 are above 1000, so they are dropped; then 7 is used.
    const spy = randomValues(1001, 1023, 7);
    expect(await heldFor()).toBe(Math.ceil((100 + 7) / 50) * 50);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it.each([-1, 1.5, 1024])("refuses an unsupported jitter of %s ms", async (jitterMs) => {
    await expect(holdAnswer(Date.now(), { floorMs: 100, jitterMs })).rejects.toThrow(RangeError);
  });
});
