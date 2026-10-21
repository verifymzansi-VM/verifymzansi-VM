import { test } from "node:test";
import assert from "node:assert/strict";
import { createCloudflareRequest, cloudflareRequestErrorMessage } from "./lib/cloudflare-api.mjs";
import { runWranglerJson } from "./lib/cloudflare-wrangler.mjs";

test("Cloudflare errors retain useful codes without provider text or credentials", async () => {
  const credential = "synthetic-private-value";
  const request = createCloudflareRequest(credential, async (_url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${credential}`);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(
      JSON.stringify({
        success: false,
        errors: [{ code: 1002, message: credential }, { code: credential }],
      }),
      { status: 403 }
    );
  });
  await assert.rejects(request("GET", "/zones/example"), (error) => {
    assert.match(cloudflareRequestErrorMessage(error), /HTTP 403; codes 1002/);
    assert.ok(!cloudflareRequestErrorMessage(error).includes(credential));
    return true;
  });
  assert.ok(!cloudflareRequestErrorMessage(new Error(credential)).includes(credential));
});

test("Cloudflare success returns only the result", async () => {
  const request = createCloudflareRequest("synthetic", async () =>
    Response.json({ success: true, result: { enabled: true } })
  );
  assert.deepEqual(await request("GET", "/zones/example"), { enabled: true });
});

test("Wrangler selectors and provider IDs remain literal process arguments", async () => {
  const selector = 'name & echo "unexpected"';
  const result = await runWranglerJson(
    ["versions", "view", "id;unexpected"],
    { workerName: selector, targetEnv: "staging $(unexpected)" },
    async (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.match(args[0].replaceAll("\\", "/"), /\/wrangler\/bin\/wrangler\.js$/);
      assert.deepEqual(args.slice(1), [
        "versions",
        "view",
        "id;unexpected",
        "--name",
        selector,
        "--env",
        "staging $(unexpected)",
        "--json",
      ]);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 60_000);
      return { stdout: '{"verified":true}' };
    }
  );
  assert.deepEqual(result, { verified: true });
});

test("Wrangler failure and malformed JSON cannot become a successful check", async () => {
  await assert.rejects(
    runWranglerJson(["deployments", "list"], {}, async () => {
      throw new Error("synthetic provider failure");
    }),
    /synthetic provider failure/
  );
  await assert.rejects(
    runWranglerJson(["deployments", "list"], {}, async () => ({ stdout: "invalid" })),
    SyntaxError
  );
});
