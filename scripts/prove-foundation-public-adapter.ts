import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFoundationPublicPost } from "../src/lib/foundation/public-post";
import { readFoundationReferenceCatalogue } from "../src/lib/foundation/reference-catalogue";
import { readFileSync } from "node:fs";
import { searchFoundationPosts } from "../src/lib/foundation/post-search";
import { createFoundationPublicApi } from "../src/lib/foundation/public-api";
import {
  parseFoundationBillingCatalogue,
  readFoundationBillingCatalogue,
} from "../src/lib/foundation/billing-catalogue";

// Called only by the owned clean-baseline HTTP proof. Synthetic short-lived JWT
// stays on stdin/in memory. This bypasses only the absent local Kong path/key
// translation; it does not claim gateway, hosted-key or GoTrue acceptance.
async function run() {
  let stage = "synthetic input";
  try {
    assert.equal(process.argv.length, 2);
    const input = JSON.parse(readFileSync(0, "utf8"));
    assert.deepEqual(Object.keys(input).sort(), ["expectedCatalogue", "token"]);
    assert.match(input.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const claims = JSON.parse(Buffer.from(input.token.split(".")[1], "base64url").toString("utf8"));
    assert.equal(claims.role, "anon");
    const now = Math.floor(Date.now() / 1000);
    assert.ok(claims.exp > now && claims.exp <= now + 120);
    let requests = 0;
    stage = "SDK request and strict DTO";
    const api = createFoundationPublicApi(
      {
        url: "http://127.0.0.1:55443",
        expectedProjectRef: "local-foundation",
        publishableKey: "sb_publishable_synthetic_proof",
      },
      async (request, init) => {
        const url = new URL(String(request));
        assert.equal(url.origin, "http://127.0.0.1:55443");
        assert.ok(
          ["billing_catalogue", "search_posts", "get_public_post", "reference_catalog"]
            .map((name) => `/rest/v1/rpc/${name}`)
            .includes(url.pathname)
        );
        assert.equal(init?.method, "POST");
        assert.equal(init?.credentials, "omit");
        assert.equal(init?.cache, "no-store");
        assert.equal(init?.redirect, "error");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("content-profile"), "api");
        assert.equal(headers.has("cookie"), false);
        headers.set("authorization", `Bearer ${input.token}`);
        requests++;
        return fetch(`http://127.0.0.1:55443${url.pathname.replace("/rest/v1", "")}`, {
          ...init,
          headers,
          signal: AbortSignal.timeout(3000),
        });
      }
    );
    const catalogue = await readFoundationBillingCatalogue(api);
    const search = await searchFoundationPosts(api, { limit: 24 });
    assert.deepEqual(search, {
      items: [],
      sort: "newest",
      total: 0,
      facets: { categories: {} },
      next_cursor: null,
    });
    const reference = await readFoundationReferenceCatalogue(api);
    assert.deepEqual(
      {
        categories: reference.categories.length,
        activities: reference.activities.length,
        provinces: reference.provinces.length,
        cities: reference.cities.length,
        fields: reference.fields.length,
      },
      { categories: 31, activities: 136, provinces: 9, cities: 90, fields: 113 }
    );
    assert.equal(await readFoundationPublicPost(api, { id: randomUUID() }), null);
    assert.equal(requests, 4);
    assert.deepEqual(catalogue, parseFoundationBillingCatalogue(input.expectedCatalogue));
    assert.equal(catalogue.plans.length, 17);
    assert.equal(catalogue.addons.length, 3);
    process.stdout.write(
      JSON.stringify({
        status: "PASS actual SDK billing/search/reference/detail adapters and strict DTOs",
        requests,
        plans: catalogue.plans.length,
        addons: catalogue.addons.length,
        emptySearch: "PASS exact empty catalogue search DTO",
        reference: "PASS strict seeded catalogue and parent references",
        missingDetail: "PASS normal null result distinct from transport failure",
        scope:
          "Local PostgREST path mapping and synthetic anon JWT; gateway/modern hosted keys/GoTrue remain separate",
      }) + "\n"
    );
  } catch {
    process.stdout.write(JSON.stringify({ status: "FAIL", stage }) + "\n");
    process.exitCode = 1;
  }
}
void run();
