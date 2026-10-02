import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { assertPortAvailable, evaluateScores } from "./run-lighthouse.mjs";

test("refuses to use a port already occupied by another server", async () => {
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const port = occupied.address().port;
  try {
    await assert.rejects(assertPortAvailable("127.0.0.1", port), { code: "EADDRINUSE" });
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
  await assertPortAvailable("127.0.0.1", port);
});

test("scores below the advisory budget warn and scores at the budget pass", () => {
  const scores = evaluateScores(
    { categories: { performance: { score: 0.69 }, accessibility: { score: 0.9 } } },
    { performance: 0.7, accessibility: 0.9 }
  );
  assert.equal(scores[0].status, "WARN");
  assert.equal(scores[1].status, "PASS");
});

test("browser failures and missing category scores cannot report success", () => {
  assert.throws(
    () => evaluateScores({ runtimeError: { message: "Browser failed" } }, {}),
    /Browser failed/
  );
  for (const score of [null, undefined, NaN]) {
    assert.throws(
      () => evaluateScores({ categories: { seo: { score } } }, { seo: 0.9 }),
      /did not produce a score/
    );
  }
});
