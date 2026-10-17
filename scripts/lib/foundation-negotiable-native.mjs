import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createFoundationPublicApi } from "../../src/lib/foundation/public-api.ts";
import { searchFoundationPosts } from "../../src/lib/foundation/post-search.ts";

import { readFoundationPublicPost } from "../../src/lib/foundation/public-post.ts";
import { readFoundationReferenceCatalogue } from "../../src/lib/foundation/reference-catalogue.ts";

import { testOwnerListingEditor } from "./foundation-owner-editor-native.mjs";

// Synthetic metadata only. Real public HTTP, owner commands and independent
// moderation are exercised; this is not physical image/provider assurance.
export async function testPublicNegotiable({
  rpc,
  sql,
  sqlFails,
  createUser,
  createReviewer,
  staff,
  connection,
  stage,
  record,
  controlledSql,
  awaitQueuedRpc,
}) {
  stage("negotiable independent owner/reviewer");
  const owner = await createUser("negotiable-owner"),
    reviewer = await createReviewer();
  const prefix = `nego${randomBytes(5).toString("hex")}`;
  sql(
    `insert into private.entitlements(owner_id,source,area,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at) values('${owner.id}','staff_grant','market','${staff.admin.id}',10,10,1,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '7 days');`
  );
  const call = async (name, args, token = owner.token, service = false) => {
    const result = await rpc(name, args, token, service);
    assert.equal(result.status, 200, `negotiable ${name}`);
    return result.data;
  };
  const image = await call("begin_media_upload", { p_kind: "image", p_bytes: 128 });
  assert.equal(
    (
      await call(
        "finalize_media",
        {
          p_object_id: image.object_id,
          p_size: 128,
          p_sha256: createHash("sha256").update("synthetic-image-metadata").digest("hex"),
          p_mime: "image/jpeg",
          p_width: 800,
          p_height: 600,
        },
        null,
        true
      )
    ).state,
    "ready"
  );
  const moderate = async (id, revision, decision) => {
    const claim = await call("claim_queue_item", { p_subject: "post", p_id: id }, reviewer.token);
    return call(
      "moderate_post",
      {
        p_post_id: id,
        p_expected_revision: revision,
        p_decision: decision,
        p_reason: decision === "reject" ? "Synthetic negotiable review" : null,
        p_claim_generation: claim.claim_generation,
        p_claim_nonce: claim.claim_nonce,
      },
      reviewer.token
    );
  };
  const cases = [
    {
      name: "amount",
      category: "electronics",
      price: { mode: "amount", amount_cents: 10000 },
      negotiable: true,
    },
    { name: "request", category: "electronics", price: { mode: "on_request" }, negotiable: true },
    { name: "free", category: "electronics", price: { mode: "free" }, negotiable: false },
    { name: "job", category: "jobs_services", price: { mode: "on_request" }, negotiable: false },
  ];
  stage("negotiable actual owner publication commands");
  for (const fixture of cases) {
    const post = await call("create_core_draft", {
      p_kind: "listing",
      p_area: "market",
      p_category_key: fixture.category,
      p_detail: {},
    });
    fixture.id = post.id;
    let changed = await call("save_core_listing_terms", {
      p_id: post.id,
      p_expected_revision: 1,
      p_terms: { price: fixture.price, negotiable: fixture.negotiable },
    });
    changed = await call("save_listing_attributes", {
      p_post_id: post.id,
      p_expected_revision: changed.revision,
      p_attributes:
        fixture.name === "job"
          ? { job_type: "full_time", location_type: "remote" }
          : { device_type: "Smartphone", brand: "Samsung", condition: "good" },
    });
    changed = await call("save_post_content", {
      p_post_id: post.id,
      p_expected_revision: changed.revision,
      p_content: {
        title: `${prefix} ${fixture.name}`,
        description: "Synthetic public negotiable advertising metadata for local regression only.",
        province_id: "gp",
        city_id: "gp_johannesburg",
      },
    });
    if (fixture.name !== "job")
      changed = await call("set_post_media", {
        p_post_id: post.id,
        p_expected_revision: changed.revision,
        p_items: [{ object_id: image.object_id, purpose: "cover", position: 0 }],
      });
    const submitted = await call("submit_post", {
      p_post_id: post.id,
      p_expected_revision: changed.revision,
    });
    await moderate(post.id, submitted.revision, "approve");
  }
  const api = createFoundationPublicApi(connection);
  const search = (filters) => searchFoundationPosts(api, { q: prefix, limit: 48, ...filters });
  const detail = (id) => readFoundationPublicPost(api, { id });
  stage("public reference actual SDK seeded contract");
  const reference = await readFoundationReferenceCatalogue(api);
  assert.deepEqual(
    [
      reference.categories.length,
      reference.activities.length,
      reference.provinces.length,
      reference.cities.length,
      reference.fields.length,
    ],
    [31, 136, 9, 90, 113]
  );
  record("native-public-reference-strict-sdk-seeded-contract");
  stage("negotiable public SDK modes and filter counts");
  const all = await search({});
  assert.equal(all.total, 4);
  for (const fixture of cases) {
    const row = all.items.find((item) => item.id === fixture.id);
    assert.ok(row);
    assert.equal(row.price_negotiable, fixture.negotiable);
    assert.equal((await detail(fixture.id)).price_negotiable, fixture.negotiable);
    assert.equal(Object.hasOwn(row, "owner_id"), false);
    assert.equal(Object.hasOwn(row, "phone"), false);
  }
  assert.equal((await search({ price_mode: "free" })).total, 1);
  assert.equal((await search({ price_mode: "on_request" })).total, 2);
  const priced = await search({
    price_mode: "amount",
    min_price_cents: 9000,
    max_price_cents: 11000,
  });
  assert.equal(priced.total, 1);
  assert.equal(priced.items[0].id, cases[0].id);
  sqlFails(
    `update private.post_search_documents set price_negotiable=true where post_id='${cases[2].id}';`,
    "23514"
  );
  sqlFails(
    `update private.post_search_documents set price_negotiable=true where post_id='${cases[3].id}';`,
    "23514"
  );
  record("native-public-negotiable-mode-roundtrip-price-filters-and-private-exclusion");

  stage("negotiable pending/rejected/approved edit isolation");
  const original = cases[1];
  const currentRevision = () =>
    Number(sql(`select revision from private.posts where id='${original.id}';`));
  const change = async () => {
    const edit = await call("create_post_edit", {
      p_post_id: original.id,
      p_expected_revision: currentRevision(),
    });
    const changed = await call("save_core_listing_terms", {
      p_id: edit.id,
      p_expected_revision: 1,
      p_terms: { price: { mode: "on_request" }, negotiable: false },
    });
    assert.equal((await detail(original.id)).price_negotiable, true);
    const submitted = await call("submit_post", {
      p_post_id: edit.id,
      p_expected_revision: changed.revision,
    });
    assert.equal((await detail(original.id)).price_negotiable, true);
    assert.equal(
      (await search({})).items.find((row) => row.id === original.id).price_negotiable,
      true
    );
    return { id: edit.id, revision: submitted.revision };
  };
  const rejected = await change();
  await moderate(rejected.id, rejected.revision, "reject");
  assert.equal((await detail(original.id)).price_negotiable, true);
  await call("discard_post_edit", {
    p_edit_id: rejected.id,
    p_expected_revision: Number(
      sql(`select revision from private.posts where id='${rejected.id}';`)
    ),
  });
  const approved = await change();
  const result = await moderate(approved.id, approved.revision, "approve");
  assert.equal(result.price_only, true);
  assert.equal((await detail(original.id)).price_negotiable, false);
  const refreshed = await search({ price_mode: "on_request" });
  assert.equal(refreshed.total, 2);
  assert.equal(refreshed.items.find((row) => row.id === original.id).price_negotiable, false);
  assert.equal(
    sql(
      `select count(*) from private.post_search_documents where kind<>'listing' and price_negotiable;`
    ),
    "0"
  );
  record("native-public-negotiable-approved-edit-refresh-and-pending-rejected-isolation");
  await testOwnerListingEditor({
    owner,
    reviewer,
    cases,
    connection,
    rpc,
    sql,
    record,
    stage,
    controlledSql,
    awaitQueuedRpc,
  });
}
