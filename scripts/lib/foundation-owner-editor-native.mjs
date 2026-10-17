import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import { createTimeoutFetch } from "../../src/lib/supabase/fetch-with-timeout.ts";
import { createFoundationPublicApi } from "../../src/lib/foundation/public-api.ts";
import {
  createFoundationListingDraft,
  readFoundationListingEditor,
} from "../../src/lib/foundation/owner-listing-editor.ts";
import { saveFoundationPostContent } from "../../src/lib/foundation/post-content.ts";
import { readFoundationPublicPost } from "../../src/lib/foundation/public-post.ts";

// Synthetic owner metadata only; byte delivery and complete form UI remain separate.
export async function testOwnerListingEditor({
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
}) {
  const editorHttp = [];
  const timedFetch = createTimeoutFetch();
  const api = createFoundationAuthenticatedApi(connection, owner.token, async (request, init) => {
    const response = await timedFetch(request, init);
    if (new URL(String(request)).pathname === "/rest/v1/rpc/get_owner_listing_editor") {
      const body = response.status === 403 ? await response.clone().json() : null;
      editorHttp.push({ status: response.status, code: body?.code ?? null });
    }
    return response;
  });
  const foreign = createFoundationAuthenticatedApi(connection, reviewer.token);
  const publicApi = createFoundationPublicApi(connection);
  const read = (id) => readFoundationListingEditor(api, { id });
  const call = async (name, args) => {
    const result = await rpc(name, args, owner.token);
    assert.equal(result.status, 200);
    return result.data;
  };
  stage("owner editor single-create and sparse content restore");
  const created = await createFoundationListingDraft(api, { category: "electronics" });
  let editor = await read(created.id);
  assert.equal(editor.revision, 1);
  assert.deepEqual(editor.attributes, {});
  assert.deepEqual(editor.media, []);
  assert.equal(editor.price_form.mode, "");
  const patch = async (content) => {
    const ack = await saveFoundationPostContent(api, {
      id: created.id,
      kind: "listing",
      expected_revision: editor.revision,
      content,
    });
    editor = await read(created.id);
    assert.equal(editor.revision, ack.revision);
    return editor;
  };
  await patch({
    title: "  Synthetic editor device  ",
    description: "Original description",
    province_id: "gp",
    city_id: "gp_johannesburg",
  });
  assert.equal(editor.content.title, "Synthetic editor device");
  await patch({ locality_label: "\t Midrand \n" });
  assert.equal(editor.content.city_id, null);
  assert.equal(editor.content.locality_label, "Midrand");
  assert.equal(editor.content.description, "Original description");
  await patch({ description: null });
  assert.equal(editor.content.title, "Synthetic editor device");
  assert.equal(editor.content.description, null);
  await assert.rejects(
    () =>
      saveFoundationPostContent(api, {
        id: created.id,
        kind: "listing",
        expected_revision: 1,
        content: { title: "Stale" },
      }),
    /^Error: Foundation post changed; reload before saving$/
  );
  assert.equal((await read(created.id)).revision, editor.revision);
  record("native-owner-editor-single-create-content-sparse-null-and-revision-restore");

  stage("owner editor live and pending edit isolation");
  const original = await read(cases[0].id);
  assert.equal(original.status, "live");
  assert.ok(original.media.length > 0);
  assert.equal(original.media[0].state, "ready");
  assert.equal(Object.hasOwn(original.media[0], "object_key"), false);
  assert.equal(Object.hasOwn(original, "owner_id"), false);
  const copy = await call("create_post_edit", {
    p_post_id: original.id,
    p_expected_revision: original.revision,
  });
  const title = "Synthetic owner editor pending copy";
  const changed = await saveFoundationPostContent(api, {
    id: copy.id,
    kind: "listing",
    expected_revision: 1,
    content: { title },
  });
  const submitted = await call("submit_post", {
    p_post_id: copy.id,
    p_expected_revision: changed.revision,
  });
  const pending = await read(copy.id);
  assert.equal(pending.status, "pending_moderation");
  assert.equal(pending.edit_of, original.id);
  assert.equal(pending.content.title, title);
  assert.deepEqual(await read(original.id), original);
  assert.equal(
    (await readFoundationPublicPost(publicApi, { id: original.id })).title,
    original.content.title
  );
  assert.equal(await readFoundationPublicPost(publicApi, { id: copy.id }), null);
  await assert.rejects(
    () =>
      saveFoundationPostContent(api, {
        id: original.id,
        kind: "listing",
        expected_revision: original.revision,
        content: { title: "No live overwrite" },
      }),
    /^Error: Foundation post content unavailable$/
  );
  await call("discard_post_edit", { p_edit_id: copy.id, p_expected_revision: submitted.revision });
  assert.equal(await read(copy.id), null);
  record("native-owner-editor-live-pending-copy-inspection-no-public-overwrite");

  stage("owner editor foreign kind role and current account denials");
  assert.equal(await readFoundationListingEditor(foreign, { id: created.id }), null);
  assert.equal(await read(randomUUID()), null);
  const nonListing = await call("create_core_draft", {
    p_kind: "business",
    p_area: "business",
    p_category_key: "automotive_services",
    p_detail: {},
  });
  assert.equal(await read(nonListing.id), null);
  for (const service of [false, true]) {
    const denied = await rpc("get_owner_listing_editor", { p_post_id: created.id }, null, service);
    assert.ok([401, 403].includes(denied.status));
  }
  const claims = JSON.parse(Buffer.from(owner.token.split(".")[1], "base64url"));
  assert.equal(claims.sub, owner.id);
  assert.match(claims.session_id, /^[a-f0-9-]{36}$/);
  const prior = sql(
    `select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='${claims.session_id}' and user_id='${owner.id}';`
  );
  assert.ok(prior);
  try {
    sql(
      `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${claims.session_id}' and user_id='${owner.id}';`
    );
    await assert.rejects(() => read(created.id), /^Error: Foundation listing editor unavailable$/);
  } finally {
    sql(
      `update auth.sessions set not_after=${prior} where id='${claims.session_id}' and user_id='${owner.id}';`
    );
  }
  const banned = sql(
    `select case when banned_until is null then 'null' else quote_literal(banned_until::text)||'::timestamptz' end from auth.users where id='${owner.id}';`
  );
  try {
    sql(
      `update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='${owner.id}';`
    );
    await assert.rejects(() => read(created.id), /^Error: Foundation listing editor unavailable$/);
  } finally {
    sql(`update auth.users set banned_until=${banned} where id='${owner.id}';`);
  }
  assert.equal((await read(created.id)).revision, editor.revision);
  record("native-owner-editor-foreign-kind-role-expired-session-restricted-account-denials");

  if (controlledSql && awaitQueuedRpc) {
    stage("owner editor session expiry during blocked snapshot read");
    const lock = controlledSql(
      "begin; lock table private.listing_details in access exclusive mode; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); commit;"
    );
    let reading;
    try {
      await lock.barrier;
      reading = read(created.id).then(
        (value) => ({ value }),
        () => ({ denied: true })
      );
      await awaitQueuedRpc("get_owner_listing_editor");
      sql(
        `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${claims.session_id}' and user_id='${owner.id}';`
      );
      assert.equal(await lock.done, 0);
      assert.deepEqual(await reading, { denied: true });
      assert.deepEqual(editorHttp.at(-1), { status: 403, code: "42501" });
    } finally {
      lock.close();
      await lock.done;
      if (reading) await reading;
      sql(
        `update auth.sessions set not_after=${prior} where id='${claims.session_id}' and user_id='${owner.id}';`
      );
    }
    assert.equal((await read(created.id)).revision, editor.revision);
    record("native-owner-editor-session-expiry-during-read-wait-denies-dto");
  }
}
