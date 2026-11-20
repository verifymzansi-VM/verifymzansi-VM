import assert from "node:assert/strict";
import { test } from "node:test";
import {
  verifyFoundationRuntimeApi,
  provisionedFoundationApiManifest,
} from "./lib/foundation-runtime-api.mjs";
import { verifyRoleOpenapi } from "./lib/foundation-api-openapi.mjs";
const connection = {
  url: "https://gntzjtuncsyefujajmjy.supabase.co",
  publishableKey: "sb_publishable_synthetic",
};
const manifest = {
  schemaVersion: 1,
  schema: "api",
  functions: [
    {
      name: "get_my_dashboard",
      arguments: [],
      execute: { anon: false, authenticated: true, service_role: false },
    },
    {
      name: "save_my_frontend_profile",
      arguments: [{ name: "p_expected_revision", sqlType: "integer", optional: false }],
      execute: { anon: false, authenticated: true, service_role: false },
    },
  ],
};
test("probes the two authenticated extensions anonymously without a user identity or session", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ code: "42501" }, { status: 401 });
  };
  assert.equal(await verifyFoundationRuntimeApi(connection, fetcher, manifest), 2);
  assert.deepEqual(
    calls.map((c) => JSON.parse(c.init.body)),
    [{}, { p_expected_revision: 1 }]
  );
  for (const { init } of calls) {
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers["Content-Profile"], "api");
  }
});
test("refuses missing, accidentally public, unavailable or malformed endpoints", async () => {
  for (const [status, body] of [
    [404, { code: "PGRST202" }],
    [200, { version: 1 }],
    [503, { error: "unavailable" }],
    [401, { code: "another" }],
  ]) {
    await assert.rejects(
      verifyFoundationRuntimeApi(connection, async () => Response.json(body, { status }), manifest),
      /presence\/authentication/
    );
  }
});

test("step-match probes carry a typed boolean while still refusing anonymous authority", async () => {
  const input = {
    ...manifest,
    functions: [
      {
        ...manifest.functions[0],
        arguments: [
          { name: "p_matches", sqlType: "boolean", optional: false },
          { name: "p_roles", sqlType: "text[]", optional: false },
        ],
      },
    ],
  };
  assert.equal(
    await verifyFoundationRuntimeApi(
      connection,
      async (_url, init) => {
        assert.deepEqual(JSON.parse(init.body), { p_matches: true, p_roles: [] });
        assert.equal(init.headers.Authorization, undefined);
        return Response.json({ code: "42501" }, { status: 401 });
      },
      input
    ),
    1
  );
});
test("an extension cannot silently widen the approved audience", async () => {
  const widened = {
    ...manifest,
    functions: [
      {
        ...manifest.functions[0],
        execute: { anon: true, authenticated: true, service_role: false },
      },
    ],
  };
  let requested = false;
  await assert.rejects(
    verifyFoundationRuntimeApi(
      connection,
      async () => {
        requested = true;
        return Response.json({});
      },
      widened
    )
  );
  assert.equal(requested, false);
});
const postIdsArgument = [{ name: "p_post_ids", sqlType: "uuid[]", optional: false }];
// A manifest holding one reviewed anonymous read with its approved audience.
const publicRead = (name, args = postIdsArgument) => ({
  ...manifest,
  functions: [
    {
      name,
      arguments: args,
      returns: "jsonb",
      volatility: "s",
      execute: { anon: true, authenticated: true, service_role: false },
    },
  ],
});
test("the reviewed public Seen projection accepts only the empty anonymous probe response", async () => {
  const input = publicRead("get_public_frontend_business_seen");
  assert.equal(
    await verifyFoundationRuntimeApi(
      connection,
      async (_url, init) => {
        assert.deepEqual(JSON.parse(init.body), { p_post_ids: [] });
        return Response.json([]);
      },
      input
    ),
    1
  );
  await assert.rejects(
    verifyFoundationRuntimeApi(
      connection,
      async () => Response.json([{ city: "unexpected" }]),
      input
    ),
    /projection probe failed/
  );
});
test("the reviewed public engagement read accepts only its empty items answer", async () => {
  const input = publicRead("get_post_engagement");
  assert.equal(
    await verifyFoundationRuntimeApi(
      connection,
      async (_url, init) => {
        assert.deepEqual(JSON.parse(init.body), { p_post_ids: [] });
        assert.equal(init.headers.Authorization, undefined);
        return Response.json({ items: [] });
      },
      input
    ),
    1
  );
  for (const [status, answer] of [
    [200, []],
    [200, {}],
    [200, null],
    [200, { items: [], extra: 1 }],
    [200, { items: {} }],
    [200, { items: null }],
    [200, { items: [{ post_id: "00000000-0000-4000-8000-000000000001", views: 0, likes: 0 }] }],
    [200, { items: [{ post_id: "00000000-0000-4000-8000-000000000001", views: 3, likes: 1 }] }],
    [201, { items: [] }],
    [401, { code: "42501" }],
    [503, { error: "unavailable" }],
  ])
    await assert.rejects(
      verifyFoundationRuntimeApi(connection, async () => Response.json(answer, { status }), input),
      /projection probe failed/
    );
  // Its audience and arguments stay as reviewed.
  for (const changed of [
    { execute: { anon: true, authenticated: false, service_role: true } },
    { arguments: [] },
    { volatility: "v" },
  ])
    await assert.rejects(
      verifyFoundationRuntimeApi(connection, async () => Response.json({ items: [] }), {
        ...input,
        functions: [{ ...input.functions[0], ...changed }],
      }),
      (error) => error.code === "ERR_ASSERTION"
    );
});
test("the reviewed public sign-up mode accepts only its one-word answer", async () => {
  const input = publicRead("get_signup_mode", []);
  for (const mode of ["invite_only", "open"])
    assert.equal(
      await verifyFoundationRuntimeApi(connection, async () => Response.json({ mode }), input),
      1
    );
  for (const answer of [{ mode: "public" }, { mode: "open", extra: 1 }, [], {}, null])
    await assert.rejects(
      verifyFoundationRuntimeApi(connection, async () => Response.json(answer), input),
      /projection probe failed/
    );
});
test("the reviewed public payment limit accepts only its one-number answer", async () => {
  const input = publicRead("get_payment_limits", []);
  assert.equal(
    await verifyFoundationRuntimeApi(
      connection,
      async () => Response.json({ online_max_cents: 130000 }),
      input
    ),
    1
  );
  for (const answer of [{ online_max_cents: 0 }, { online_max_cents: 1, extra: 1 }, []])
    await assert.rejects(
      verifyFoundationRuntimeApi(connection, async () => Response.json(answer), input),
      /projection probe failed/
    );
  // It may never become callable by the service role or take arguments.
  await assert.rejects(
    verifyFoundationRuntimeApi(connection, async () => Response.json({}), {
      ...input,
      functions: [
        {
          ...input.functions[0],
          execute: { anon: true, authenticated: false, service_role: true },
        },
      ],
    })
  );
});
test("service-only extensions are probed anonymously with synthetic arguments and never a service key", async () => {
  let calls = 0;
  const input = {
    ...manifest,
    functions: [
      {
        name: "frontend_verification_upload_context",
        arguments: [
          { name: "p_owner", sqlType: "uuid" },
          { name: "p_request", sqlType: "uuid" },
        ],
        execute: { anon: false, authenticated: false, service_role: true },
      },
    ],
  };
  assert.equal(
    await verifyFoundationRuntimeApi(
      connection,
      async (_url, init) => {
        calls++;
        assert.equal(init.headers.Authorization, undefined);
        assert.equal(JSON.parse(init.body).p_owner, "00000000-0000-4000-8000-000000000001");
        return Response.json({ code: "42501" }, { status: 401 });
      },
      input
    ),
    1
  );
  assert.equal(calls, 1);
  await assert.rejects(
    verifyFoundationRuntimeApi(
      connection,
      async () => {
        throw Error("must not request");
      },
      {
        ...input,
        functions: [
          {
            ...input.functions[0],
            execute: { anon: false, authenticated: true, service_role: true },
          },
        ],
      }
    )
  );
});
test("provisioned OpenAPI includes precisely reviewed extensions without changing baseline contracts", () => {
  const service = {
    name: "trusted_command",
    volatility: "v",
    arguments: [],
    execute: { anon: false, authenticated: false, service_role: true },
  };
  const base = { functions: [{ ...manifest.functions[0], volatility: "v" }] };
  const extended = provisionedFoundationApiManifest(base, { ...manifest, functions: [service] });
  const spec = {
    swagger: "2.0",
    definitions: {},
    paths: {
      "/rpc/trusted_command": {
        post: { parameters: [{ in: "body", schema: { type: "object" } }] },
      },
    },
  };
  assert.equal(verifyRoleOpenapi(spec, extended, "service_role"), 1);
  assert.equal(base.functions.length, 1);
  assert.throws(
    () => provisionedFoundationApiManifest(base, { ...manifest, functions: [base.functions[0]] }),
    /replace baseline/
  );
  assert.throws(
    () =>
      verifyRoleOpenapi(
        { ...spec, paths: { ...spec.paths, "/rpc/unreviewed": { post: {} } } },
        extended,
        "service_role"
      ),
    /role surface/
  );
});
