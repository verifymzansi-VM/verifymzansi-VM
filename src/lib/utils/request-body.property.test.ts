/** @vitest-environment node */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readBoundedRequestText, RequestBodyTooLargeError } from "./request-body";

// Property test for the bounded body reader every JSON route uses (see
// request-body.test.ts for named examples): it returns the text exactly when
// its UTF-8 size is within the limit, however the body arrives.

function streamOf(bytes: Uint8Array<ArrayBuffer>, cuts: number[]) {
  const points = [...new Set(cuts.map((cut) => cut % (bytes.length + 1)))].sort((a, b) => a - b);
  const pieces: Uint8Array<ArrayBuffer>[] = [];
  let start = 0;
  for (const point of [...points, bytes.length]) {
    if (point > start) pieces.push(bytes.slice(start, point));
    start = Math.max(start, point);
  }
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      const next = pieces.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
}

describe("readBoundedRequestText", () => {
  it("returns the text within the limit and refuses anything larger, in any chunking", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: "binary", maxLength: 200 }),
        fc.integer({ min: 0, max: 400 }),
        fc.array(fc.nat(), { maxLength: 6 }),
        fc.boolean(),
        async (text, limit, cuts, declare) => {
          const bytes = new TextEncoder().encode(text);
          const headers = new Headers(declare ? { "content-length": String(bytes.length) } : {});
          const request = { body: streamOf(bytes, cuts), headers, text: async () => text };
          const read = readBoundedRequestText(request, limit);
          if (bytes.length <= limit) expect(await read).toBe(text);
          else await expect(read).rejects.toBeInstanceOf(RequestBodyTooLargeError);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("refuses a declared size over the limit before reading anything", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        async (limit, extra) => {
          let pulled = false;
          // A high-water mark of 0: the stream pulls only when something reads it.
          const body = new ReadableStream<Uint8Array<ArrayBuffer>>(
            {
              pull() {
                pulled = true;
              },
            },
            { highWaterMark: 0 }
          );
          const headers = new Headers({ "content-length": String(limit + extra) });
          await expect(
            readBoundedRequestText({ body, headers, text: async () => "" }, limit)
          ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
          expect(pulled).toBe(false);
        }
      )
    );
  });
});
