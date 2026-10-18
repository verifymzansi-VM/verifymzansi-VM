import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import { createTimeoutFetch } from "../../src/lib/supabase/fetch-with-timeout.ts";
import { createFoundationPostDraft } from "../../src/lib/foundation/post-draft.ts";
import { readFoundationBusinessEventEditor } from "../../src/lib/foundation/owner-business-event-editor.ts";
import {
  buildFoundationBusinessEventContext,
  saveFoundationBusinessEventContext,
} from "../../src/lib/foundation/business-event-context.ts";
import { testEventContextApprovals } from "./foundation-event-edit-native.mjs";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };

export async function testBusinessEventContext({
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
  stage("context fresh actual owner");
  const owner = await createUser("context-owner"),
    http = [],
    timed = createTimeoutFetch();
  const api = createFoundationAuthenticatedApi(connection, owner.token, async (request, init) => {
    const response = await timed(request, init);
    if (new URL(String(request)).pathname === "/rest/v1/rpc/save_business_event_context") {
      const body = response.ok ? null : await response.clone().json();
      http.push({ status: response.status, code: body?.code ?? null });
    }
    return response;
  });
  const call = async (name, args, token = owner.token, service = false) => {
    const result = await rpc(name, args, token, service);
    assert.equal(result.status, 200, `context ${name}`);
    return result.data;
  };
  const read = (id) => readFoundationBusinessEventEditor(api, { id });
  const raw = (args, token = owner.token, service = false) =>
    rpc("save_business_event_context", args, token, service);
  const save = (id, expected_revision, patch) =>
    saveFoundationBusinessEventContext(api, { id, expected_revision, patch });
  const snapshot = (id) =>
    sql(
      `select jsonb_build_object('post',to_jsonb(p),'event',(select to_jsonb(e) from private.event_details e where e.post_id=p.id)) from private.posts p where p.id='${id}';`
    );
  const create = (context) => createFoundationPostDraft(api, { context, detail: {} });
  const choices = (category) =>
    reference.activities.filter((row) => row.category === category).map((row) => row.key);
  const businessKeys = choices("automotive_services"),
    eventKeys = choices("events"),
    tourismKeys = choices("tourism_hospitality");
  assert.ok(businessKeys.length > 1 && eventKeys.length > 1);
  const business = await create({
    kind: "business",
    area: "business",
    category_key: "automotive_services",
  });
  const tourism = await create({
    kind: "business",
    area: "tourism_events",
    category_key: "tourism_hospitality",
    activity_key: tourismKeys[0],
  });
  const listing = await create({ kind: "listing", area: "market", category_key: "electronics" });
  const initial = {
    starts_at: "2020-01-01T00:00:00.000Z",
    ends_at: "2020-01-01T01:00:00.000Z",
    timezone: "US/Eastern",
  };
  const event = await call("create_core_draft", {
    p_kind: "event",
    p_area: "tourism_events",
    p_category_key: "events",
    p_activity_key: eventKeys[0],
    p_detail: initial,
  });
  let b = await read(business.id),
    e = await read(event.id);
  let ack = await save(b.id, b.revision, { activity_key: businessKeys[0] });
  b = await read(b.id);
  assert.equal(b.activity_key, businessKeys[0]);
  assert.equal(b.revision, ack.revision);
  ack = await save(b.id, b.revision, { activity_key: null });
  b = await read(b.id);
  assert.equal(b.activity_key, null);
  assert.equal(b.revision, ack.revision);
  const both = {
    activity_key: eventKeys[1],
    event_window: {
      starts_at: "2020-01-01T02:00:00+02:00",
      ends_at: "2020-01-01T04:00:00.1+02:00",
      timezone: "US/Eastern",
    },
  };
  ack = await save(e.id, e.revision, both);
  e = await read(e.id);
  assert.equal(e.revision, 2);
  assert.equal(e.revision, ack.revision);
  assert.equal(e.activity_key, eventKeys[1]);
  assert.deepEqual(
    e.event_window,
    buildFoundationBusinessEventContext({ id: e.id, expected_revision: 1, patch: both }).p_patch
      .event_window
  );
  ack = await save(e.id, e.revision, { event_window: initial });
  e = await read(e.id);
  assert.equal(e.activity_key, eventKeys[1]);
  assert.deepEqual(e.event_window, initial);
  assert.equal(e.revision, ack.revision);
  for (const status of ["rejected", "paused"]) {
    sql(
      `update private.posts set status='${status}' where id='${b.id}' and owner_id='${owner.id}';`
    );
    ack = await save(b.id, b.revision, { activity_key: null });
    b = await read(b.id);
    assert.equal(b.revision, ack.revision);
    assert.equal(b.status, status);
  }
  sql(`update private.posts set status='draft' where id='${b.id}' and owner_id='${owner.id}';`);
  b = await read(b.id);
  record("native-context-sparse-activity-clear-window-alias-and-stored-editable-states");

  stage("context malformed foreign kind and stale no partial mutation");
  const invalid = [
    [b.id, b.revision, {}],
    [b.id, b.revision, null],
    [b.id, b.revision, { owner_id: owner.id }],
    [b.id, b.revision, { category_key: "events" }],
    [b.id, b.revision, { activity_key: [] }],
    [b.id, b.revision, { activity_key: "unknown_activity" }],
    [b.id, b.revision, { activity_key: eventKeys[0] }],
    [tourism.id, 1, { activity_key: null }],
    [listing.id, 1, { activity_key: null }],
    [b.id, b.revision, { activity_key: businessKeys[0], event_window: initial }],
    [
      e.id,
      e.revision,
      { activity_key: null, event_window: { ...initial, ends_at: "2020-01-01T02:00:00.000Z" } },
    ],
    [e.id, e.revision, { event_window: null }],
    [e.id, e.revision, { event_window: { starts_at: initial.starts_at } }],
    [e.id, e.revision, { event_window: { ...initial, role: "service_role" } }],
    [e.id, e.revision, { event_window: { ...initial, timezone: "Invalid/Zone" } }],
    [e.id, e.revision, { event_window: { ...initial, starts_at: "2020-01-01T00:00:00.000001Z" } }],
    [e.id, e.revision, { event_window: { ...initial, ends_at: "2020-05-01T00:00:00.000Z" } }],
    [
      e.id,
      e.revision,
      {
        event_window: {
          starts_at: "0001-01-01T00:00:00+14:00",
          ends_at: "0001-01-01T01:00:00+14:00",
          timezone: "UTC",
        },
      },
    ],
    [
      e.id,
      e.revision,
      {
        event_window: {
          starts_at: "9999-12-31T23:00:00-14:00",
          ends_at: "9999-12-31T23:30:00-14:00",
          timezone: "UTC",
        },
      },
    ],
  ];
  for (const [id, revision, patch] of invalid) {
    const before = snapshot(id),
      denied = await raw({ p_post_id: id, p_expected_revision: revision, p_patch: patch });
    assert.equal(denied.status, 400);
    assert.equal(denied.data.code, "22023");
    assert.equal(snapshot(id), before);
  }
  for (const id of [b.id, randomUUID()]) {
    const before = id === b.id ? snapshot(id) : null;
    const denied = await raw(
      { p_post_id: id, p_expected_revision: 1, p_patch: { activity_key: null } },
      reviewer.token
    );
    assert.equal(denied.status, 400);
    assert.equal(denied.data.code, "22023");
    if (before) assert.equal(snapshot(id), before);
  }
  const staleBefore = snapshot(b.id),
    stale = await raw({
      p_post_id: b.id,
      p_expected_revision: b.revision - 1,
      p_patch: { activity_key: businessKeys[1] },
    });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, "PT409");
  assert.equal(snapshot(b.id), staleBefore);
  for (const revision of [0, 2147483647]) {
    const denied = await raw({
      p_post_id: b.id,
      p_expected_revision: revision,
      p_patch: { activity_key: null },
    });
    assert.equal(denied.status, 400);
    assert.equal(denied.data.code, "22023");
    assert.equal(snapshot(b.id), staleBefore);
  }
  record("native-context-invalid-fields-kind-category-utc-and-revision-atomicity");

  stage("context current caller restrictions");
  const command = () => ({
    p_post_id: b.id,
    p_expected_revision: b.revision,
    p_patch: { activity_key: null },
  });
  for (const service of [false, true])
    assert.ok([401, 403].includes((await raw(command(), null, service)).status));
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
    for (const id of [b.id, randomUUID()]) {
      const before = http.length;
      await assert.rejects(
        () => save(id, b.revision, { activity_key: null }),
        /^Error: Foundation business\/event context unavailable$/
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
      () => save(b.id, b.revision, { activity_key: null }),
      /^Error: Foundation business\/event context unavailable$/
    );
    assert.equal(http.length, before + 1);
    assert.deepEqual(http[before], { status: 403, code: "42501" });
  } finally {
    sql(`update auth.users set banned_until=${banned} where id='${owner.id}';`);
  }
  assert.equal(snapshot(b.id), staleBefore);
  assert.equal((await read(b.id)).revision, b.revision);
  record("native-context-real-session-account-and-role-denials");

  if (controlledSql && awaitQueuedRpc) {
    stage("context owner expiry while post row locked");
    assert.equal((await read(b.id)).revision, b.revision);
    const before = http.length,
      state = snapshot(b.id);
    const lock = controlledSql(
      `begin; select id from private.posts where id='${b.id}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); commit;`
    );
    let saving;
    try {
      await lock.barrier;
      saving = save(b.id, b.revision, { activity_key: businessKeys[1] }).then(
        (value) => ({ value }),
        (error) => ({ error: error.message })
      );
      await awaitQueuedRpc("save_business_event_context");
      sql(
        `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${claims.session_id}' and user_id='${owner.id}';`
      );
      assert.equal(await lock.done, 0);
      assert.deepEqual(await saving, { error: "Foundation business/event context unavailable" });
      assert.equal(http.length, before + 1);
      assert.deepEqual(http[before], { status: 403, code: "42501" });
      assert.equal(snapshot(b.id), state);
    } finally {
      lock.close();
      await lock.done;
      if (saving) await saving;
      sql(
        `update auth.sessions set not_after=${prior} where id='${claims.session_id}' and user_id='${owner.id}';`
      );
    }
    record("native-context-expired-owner-during-post-wait-rolls-back");
  }
  await testEventContextApprovals({
    owner,
    reviewer,
    connection,
    rpc,
    sql,
    record,
    stage,
    controlledSql,
    awaitQueuedRpc,
    api,
    read,
    save,
    call,
    eventKeys,
  });
}
