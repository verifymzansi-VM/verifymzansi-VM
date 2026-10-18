import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import { createTimeoutFetch } from "../../src/lib/supabase/fetch-with-timeout.ts";
import { createFoundationPostDraft } from "../../src/lib/foundation/post-draft.ts";
import { readFoundationBusinessEventEditor } from "../../src/lib/foundation/owner-business-event-editor.ts";
import { saveFoundationPostContent } from "../../src/lib/foundation/post-content.ts";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };

// Metadata only: synthetic scanner finalization and stored live/pending fixtures
// below do not establish physical media or complete submit/moderate workflows.
export async function testOwnerBusinessEventEditor({
  createUser,
  reviewer,
  connection,
  rpc,
  sql,
  record,
  stage,
  controlledSql,
  awaitQueuedRpc,
}) {
  stage("business/event metadata fresh actual owner");
  const owner = await createUser("business-event-editor-owner"),
    http = [],
    timed = createTimeoutFetch();
  const api = createFoundationAuthenticatedApi(connection, owner.token, async (request, init) => {
    const response = await timed(request, init);
    if (new URL(String(request)).pathname === "/rest/v1/rpc/get_owner_business_event_editor") {
      const body = response.status === 403 ? await response.clone().json() : null;
      http.push({ status: response.status, code: body?.code ?? null });
    }
    return response;
  });
  const foreign = createFoundationAuthenticatedApi(connection, reviewer.token);
  const read = (id) => readFoundationBusinessEventEditor(api, { id });
  const call = async (name, args, token = owner.token, service = false) => {
    const result = await rpc(name, args, token, service);
    assert.equal(result.status, 200, `business/event editor ${name}`);
    return result.data;
  };
  const create = (context) => createFoundationPostDraft(api, { context, detail: {} });
  const business = await create({
    kind: "business",
    area: "business",
    category_key: "automotive_services",
  });
  const tourism = await create({
    kind: "business",
    area: "tourism_events",
    category_key: "tourism_hospitality",
    activity_key: reference.activities.find((row) => row.category === "tourism_hospitality").key,
  });
  const event = await call("create_core_draft", {
    p_kind: "event",
    p_area: "tourism_events",
    p_category_key: "events",
    p_activity_key: reference.activities.find((row) => row.category === "events").key,
    p_detail: {
      starts_at: "2020-01-01T00:00:00.123Z",
      ends_at: "2020-01-01T01:00:00.123Z",
      timezone: "US/Eastern",
    },
  });
  const listing = await create({ kind: "listing", area: "market", category_key: "electronics" });
  for (const draft of [business, tourism, event]) {
    const value = await read(draft.id);
    assert.equal(value.id, draft.id);
    assert.equal(value.kind, draft.kind);
    assert.equal(value.revision, 1);
    assert.equal(value.activity_key, draft.activity_key ?? null);
    assert.equal(value.content.title, null);
    assert.deepEqual(value.media, []);
  }
  assert.deepEqual((await read(event.id)).event_window, {
    starts_at: "2020-01-01T00:00:00.123Z",
    ends_at: "2020-01-01T01:00:00.123Z",
    timezone: "US/Eastern",
  });
  assert.equal((await read(business.id)).event_window, null);
  record("native-owner-business-event-core-snapshot-and-ended-alias-window");

  stage("business/event actual content and media metadata roundtrip");
  const updated = await saveFoundationPostContent(api, {
    id: business.id,
    kind: "business",
    expected_revision: 1,
    content: {
      title: "Synthetic business editor",
      description: "Owned metadata",
      province_id: "gp",
      city_id: "gp_johannesburg",
    },
  });
  const image = await call("begin_media_upload", { p_kind: "image", p_bytes: 128 });
  await call(
    "finalize_media",
    {
      p_object_id: image.object_id,
      p_size: 128,
      p_sha256: createHash("sha256")
        .update("business-event-editor synthetic metadata")
        .digest("hex"),
      p_mime: "image/jpeg",
      p_width: 800,
      p_height: 600,
    },
    null,
    true
  );
  const media = await call("set_post_media", {
    p_post_id: business.id,
    p_expected_revision: updated.revision,
    p_items: [
      { object_id: image.object_id, purpose: "cover", position: 0 },
      { object_id: image.object_id, purpose: "gallery", position: 0 },
    ],
  });
  const restored = await read(business.id);
  assert.equal(restored.revision, media.revision);
  assert.equal(restored.content.title, "Synthetic business editor");
  assert.equal(restored.media.length, 2);
  assert.equal(restored.media[0].object_id, restored.media[1].object_id);
  assert.equal(Object.hasOwn(restored, "owner_id"), false);
  assert.equal(Object.hasOwn(restored.media[0], "object_key"), false);
  record("native-owner-business-event-content-media-and-revision");

  stage("business/event stored-state inspection and separate edit-copy snapshot");
  // Direct SQL establishes stored lifecycle fixtures only; the read and edit
  // commands use the actual owner JWT. No public projection is fabricated.
  sql(
    `update private.posts set status='live',published_at=clock_timestamp(),visible_until=clock_timestamp()+interval '1 day' where id='${business.id}' and owner_id='${owner.id}';`
  );
  const original = await read(business.id);
  const copy = await call("create_post_edit", {
    p_post_id: business.id,
    p_expected_revision: original.revision,
  });
  const changed = await saveFoundationPostContent(api, {
    id: copy.id,
    kind: "business",
    expected_revision: 1,
    content: { title: "Synthetic pending metadata copy" },
  });
  sql(
    `update private.posts set status='pending_moderation' where id='${copy.id}' and owner_id='${owner.id}';`
  );
  const pending = await read(copy.id);
  assert.equal(pending.status, "pending_moderation");
  assert.equal(pending.edit_of, business.id);
  assert.equal(pending.content.title, "Synthetic pending metadata copy");
  assert.deepEqual(await read(business.id), original);
  await assert.rejects(
    () =>
      saveFoundationPostContent(api, {
        id: business.id,
        kind: "business",
        expected_revision: original.revision,
        content: { title: "No live overwrite" },
      }),
    /^Error: Foundation post content unavailable$/
  );
  await call("discard_post_edit", { p_edit_id: copy.id, p_expected_revision: changed.revision });
  assert.equal(await read(copy.id), null);
  sql(
    `update private.posts set status='archived' where id='${event.id}' and owner_id='${owner.id}';`
  );
  assert.equal((await read(event.id)).status, "archived");
  record("native-owner-business-event-stored-state-inspection-copy-isolation");

  stage("business/event owner kind role and current actor denials");
  assert.equal(await read(listing.id), null);
  assert.equal(await read(randomUUID()), null);
  assert.equal(await readFoundationBusinessEventEditor(foreign, { id: business.id }), null);
  for (const service of [false, true])
    assert.ok(
      [401, 403].includes(
        (await rpc("get_owner_business_event_editor", { p_post_id: business.id }, null, service))
          .status
      )
    );
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
    for (const id of [business.id, randomUUID()]) {
      const before = http.length;
      await assert.rejects(
        () => read(id),
        /^Error: Foundation business\/event editor unavailable$/
      );
      assert.equal(http.length, before + 1);
      assert.deepEqual(http[before], { status: 403, code: "42501" });
    }
  } finally {
    sql(
      `update auth.sessions set not_after=${prior} where id='${claims.session_id}' and user_id='${owner.id}';`
    );
  }
  const banned = sql(
    `select case when banned_until is null then 'null' else quote_literal(banned_until::text)||'::timestamptz' end from auth.users where id='${owner.id}';`
  );
  assert.ok(banned);
  try {
    sql(
      `update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='${owner.id}';`
    );
    const before = http.length;
    await assert.rejects(
      () => read(business.id),
      /^Error: Foundation business\/event editor unavailable$/
    );
    assert.equal(http.length, before + 1);
    assert.deepEqual(http[before], { status: 403, code: "42501" });
  } finally {
    sql(`update auth.users set banned_until=${banned} where id='${owner.id}';`);
  }
  record("native-owner-business-event-authority-and-resource-denials");

  if (controlledSql && awaitQueuedRpc) {
    stage("business/event session expiry during blocked metadata read");
    assert.equal((await read(event.id)).status, "archived");
    const before = http.length;
    const lock = controlledSql(
      "begin; lock table private.event_details in access exclusive mode; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); commit;"
    );
    let reading;
    try {
      await lock.barrier;
      reading = read(event.id).then(
        (value) => ({ value }),
        () => ({ denied: true })
      );
      await awaitQueuedRpc("get_owner_business_event_editor");
      sql(
        `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${claims.session_id}' and user_id='${owner.id}';`
      );
      assert.equal(await lock.done, 0);
      assert.deepEqual(await reading, { denied: true });
      assert.equal(http.length, before + 1);
      assert.deepEqual(http[before], { status: 403, code: "42501" });
    } finally {
      lock.close();
      await lock.done;
      if (reading) await reading;
      sql(
        `update auth.sessions set not_after=${prior} where id='${claims.session_id}' and user_id='${owner.id}';`
      );
    }
    assert.equal((await read(event.id)).status, "archived");
    record("native-owner-business-event-expiry-during-blocked-read");
  }
}
