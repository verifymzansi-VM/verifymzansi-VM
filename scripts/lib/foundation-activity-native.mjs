import assert from "node:assert/strict";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import {
  createFoundationPostDraft,
  readFoundationPostDraft,
} from "../../src/lib/foundation/post-draft.ts";
import { readCoreDraft } from "../../src/lib/domains/posts/identity.ts";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };

export async function testCoreActivityCreation({
  createUser,
  reviewer,
  connection,
  rpc,
  sql,
  record,
  stage,
}) {
  stage("activity creation fresh real owner");
  const owner = await createUser("activity-owner");
  const api = createFoundationAuthenticatedApi(connection, owner.token);
  const foreign = createFoundationAuthenticatedApi(connection, reviewer.token);
  const choices = (category) => reference.activities.filter((row) => row.category === category);
  const eventActivity = choices("events")[0].key;
  const tourismActivity = choices("tourism_hospitality")[0].key;
  const optionalActivity = choices("automotive_services")[0].key;
  const detail = {
    starts_at: new Date(Date.now() + 3600000).toISOString(),
    ends_at: new Date(Date.now() + 7200000).toISOString(),
    timezone: "Africa/Johannesburg",
  };
  const legacy = {
    p_kind: "listing",
    p_area: "market",
    p_category_key: "electronics",
    p_detail: {},
  };
  const count = () =>
    Number(sql(`select count(*) from private.posts where owner_id='${owner.id}';`));
  const read = (id) => readFoundationPostDraft(api, { id });
  const old = await createFoundationPostDraft(api, {
    context: { kind: "listing", area: "market", category_key: "electronics" },
    detail: {},
  });
  assert.equal(Object.keys(old).length, 6);
  assert.equal(count(), 1);
  const claims = JSON.parse(Buffer.from(owner.token.split(".")[1], "base64url"));
  assert.equal(claims.sub, owner.id);
  assert.match(claims.session_id, /^[a-f0-9-]{36}$/);
  // Direct SQL supplies a minimal synthetic request context ONLY to prove old
  // positional resolution. The real JWT trust boundary is the HTTP matrix.
  const context = JSON.stringify({
    role: "authenticated",
    sub: owner.id,
    session_id: claims.session_id,
  });
  assert.ok(!context.includes("'"));
  const positional = sql(
    `begin; do $ctx$ begin perform set_config('request.jwt.claims','${context}',true); end $ctx$; set local role authenticated; select api.create_core_draft('listing','market','electronics','{}'::jsonb); rollback;`
  );
  const positionalDto = readCoreDraft(
    JSON.parse(positional.split("\n").find((line) => line.startsWith("{")))
  );
  assert.equal(Object.keys(positionalDto).length, 6);
  assert.equal(count(), 1);
  record("native-activity-legacy-four-named-http-and-four-positional-sql-compatibility");

  stage("activity real canonical create and identity restore");
  const event = await createFoundationPostDraft(api, {
    context: {
      kind: "event",
      area: "tourism_events",
      category_key: "events",
      activity_key: eventActivity,
    },
    detail,
  });
  const tourism = await createFoundationPostDraft(api, {
    context: {
      kind: "business",
      area: "tourism_events",
      category_key: "tourism_hospitality",
      activity_key: tourismActivity,
    },
    detail: {},
  });
  const optional = await createFoundationPostDraft(api, {
    context: {
      kind: "business",
      area: "business",
      category_key: "automotive_services",
      activity_key: optionalActivity,
    },
    detail: {},
  });
  for (const [draft, activity] of [
    [event, eventActivity],
    [tourism, tourismActivity],
    [optional, optionalActivity],
  ]) {
    assert.equal(draft.activity_key, activity);
    assert.deepEqual(await read(draft.id), draft);
    assert.equal(await readFoundationPostDraft(foreign, { id: draft.id }), null);
    assert.equal(
      sql(
        `select activity_key from private.posts where id='${draft.id}' and owner_id='${owner.id}';`
      ),
      activity
    );
  }
  assert.equal(count(), 4);
  record("native-activity-required-event-tourism-and-optional-business-sdk-roundtrip");

  stage("activity invalid pairs leave no partial rows");
  const invalid = [
    { p_kind: "event", p_area: "tourism_events", p_category_key: "events", p_detail: detail },
    {
      p_kind: "business",
      p_area: "tourism_events",
      p_category_key: "tourism_hospitality",
      p_detail: {},
    },
    { ...legacy, p_activity_key: eventActivity },
    {
      p_kind: "event",
      p_area: "tourism_events",
      p_category_key: "events",
      p_activity_key: tourismActivity,
      p_detail: detail,
    },
    {
      p_kind: "business",
      p_area: "business",
      p_category_key: "automotive_services",
      p_activity_key: "unknown_activity",
      p_detail: {},
    },
  ];
  for (const request of invalid) {
    const result = await rpc("create_core_draft", request, owner.token);
    assert.equal(result.status, 400);
    assert.equal(result.data.code, "22023");
    assert.equal(count(), 4);
  }
  const explicitNull = await rpc(
    "create_core_draft",
    { ...legacy, p_activity_key: null },
    owner.token
  );
  assert.equal(explicitNull.status, 200);
  assert.equal(Object.keys(explicitNull.data).length, 6);
  assert.equal(count(), 5);
  const cap = await rpc("create_core_draft", legacy, owner.token);
  assert.equal(cap.status, 429);
  assert.equal(count(), 5);
  const children = JSON.parse(
    sql(
      `select json_build_object('listing',(select count(*) from private.listing_details d join private.posts p on p.id=d.post_id where p.owner_id='${owner.id}'),'business',(select count(*) from private.business_details d join private.posts p on p.id=d.post_id where p.owner_id='${owner.id}'),'event',(select count(*) from private.event_details d join private.posts p on p.id=d.post_id where p.owner_id='${owner.id}'));`
    )
  );
  assert.deepEqual(children, { listing: 2, business: 2, event: 1 });
  record("native-activity-invalid-pairs-atomicity-explicit-null-and-unchanged-draft-quota");

  stage("activity authority and exact signatures");
  for (const service of [false, true])
    assert.ok([401, 403].includes((await rpc("create_core_draft", legacy, null, service)).status));
  const deadline = sql(
    `select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='${claims.session_id}' and user_id='${owner.id}';`
  );
  assert.ok(deadline);
  try {
    sql(
      `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${claims.session_id}' and user_id='${owner.id}';`
    );
    const denied = await rpc("create_core_draft", legacy, owner.token);
    assert.equal(denied.status, 403);
    assert.equal(denied.data.code, "42501");
    await assert.rejects(() => read(event.id), /^Error: Foundation post draft unavailable$/);
  } finally {
    sql(
      `update auth.sessions set not_after=${deadline} where id='${claims.session_id}' and user_id='${owner.id}';`
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
    const denied = await rpc("create_core_draft", legacy, owner.token);
    assert.equal(denied.status, 403);
    assert.equal(denied.data.code, "42501");
  } finally {
    sql(`update auth.users set banned_until=${banned} where id='${owner.id}';`);
  }
  assert.equal(count(), 5);
  assert.deepEqual(await read(event.id), event);
  const signatures = JSON.parse(
    sql(
      "select jsonb_agg(jsonb_build_object('schema',n.nspname,'args',oidvectortypes(p.proargtypes),'defaults',p.pronargdefaults,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),'memberExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by n.nspname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('api','internal') and p.proname='create_core_draft';"
    )
  );
  assert.deepEqual(
    signatures,
    ["api", "internal"].map((schema) => ({
      schema,
      args: "text, text, text, jsonb, text",
      defaults: 1,
      publicExecute: false,
      memberExecute: true,
      anonExecute: false,
      serviceExecute: false,
    }))
  );
  record("native-activity-current-authority-single-defaulted-signature-and-exact-grants");
}
