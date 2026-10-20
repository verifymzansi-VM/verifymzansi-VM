import { controlNativeSqlChild } from "./lib/foundation-native-sql-barrier.mjs";
import {
  createPostingVerifier,
  createTrustedPostingFixture,
} from "./lib/foundation-trusted-posting-fixture.mjs";
import { testPublicationVerificationReadiness } from "./lib/foundation-publication-readiness-native.mjs";
import { nativeTotp } from "./lib/foundation-native-totp.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  nativeIsolation,
  nativeDigest as digest,
  FIXTURE_MIGRATIONS,
} from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
import { testPublicNegotiable } from "./lib/foundation-negotiable-native.mjs";
import { testTrustedIdentity } from "./lib/foundation-identity-native.mjs";

// Fixed isolated workspace/container. No .env loading or arbitrary URL/SQL arguments.
async function run() {
  const isolation = nativeIsolation();
  const release = acquireFixtureOperation(isolation.workdir, "test");
  try {
    await runFixture(isolation, release);
  } finally {
    release();
  }
}
async function runFixture({ workdir, config, env, cliPath, dockerArgs }, release) {
  const provenance = Object.fromEntries(
    [
      "scripts/test-foundation-native.mjs",
      "scripts/lib/foundation-native-isolation.mjs",
      "scripts/lib/foundation-native-lock.mjs",
      "scripts/lib/foundation-native-paths.mjs",
      "scripts/lib/foundation-native-sql-barrier.mjs",
      "scripts/lib/foundation-native-owner-restrictions.mjs",
      "scripts/lib/foundation-identity-native.mjs",
      "scripts/lib/foundation-negotiable-native.mjs",
      "scripts/lib/foundation-activity-native.mjs",
      "docs/backend-foundation/prototypes/core-activity-create.sql",
      "src/lib/foundation/post-draft.ts",
      "scripts/lib/foundation-business-event-editor-native.mjs",
      "docs/backend-foundation/prototypes/owner-business-event-editor.sql",
      "src/lib/foundation/owner-business-event-editor.ts",
      "src/lib/foundation/owner-editor-media.ts",
      "scripts/lib/foundation-context-native.mjs",
      "scripts/lib/foundation-event-edit-native.mjs",
      "docs/backend-foundation/prototypes/business-event-context.sql",
      "docs/backend-foundation/prototypes/public-event-window.sql",
      "src/lib/foundation/event-window-dto.ts",
      "scripts/lib/foundation-financial-snapshot.mjs",
      "scripts/lib/foundation-event-duplicates-native.mjs",
      "docs/backend-foundation/prototypes/event-duplicate-admission.sql",
      "src/lib/foundation/post-submission.ts",
      "scripts/lib/foundation-native-totp.mjs",
      "scripts/lib/foundation-staff-event-flags-native.mjs",
      "src/lib/foundation/verification-readiness.ts",
      "scripts/lib/foundation-publication-readiness-native.mjs",
      "scripts/lib/foundation-trusted-posting-fixture.mjs",
      "docs/backend-foundation/prototypes/publication-verification-readiness.sql",
      "scripts/lib/foundation-post-contacts-native.mjs",
      "docs/backend-foundation/prototypes/post-contact-preferences.sql",
      "src/lib/foundation/post-contacts.ts",
      "src/lib/domains/posts/contact-channels.ts",
      "docs/backend-foundation/prototypes/staff-event-duplicate-flags.sql",
      "src/lib/foundation/staff-event-duplicate-flags.ts",
      "src/lib/foundation/business-event-context.ts",
      "scripts/lib/foundation-owner-editor-native.mjs",
      "docs/backend-foundation/prototypes/owner-listing-editor.sql",
      "src/lib/foundation/owner-listing-editor.ts",
      "src/lib/foundation/post-content.ts",
      "src/lib/domains/taxonomy/attributes.ts",
      "src/lib/foundation/public-api.ts",
      "src/lib/foundation/post-search.ts",
      "src/lib/foundation/public-post-contract.ts",
      "src/lib/foundation/public-post.ts",
      "src/lib/foundation/reference-catalogue.ts",
      "docs/backend-foundation/prototypes/native-supabase-config.toml",
      "docs/backend-foundation/prototypes/transport.sql",
      "docs/backend-foundation/prototypes/listing-price-drafts.sql",
      "docs/backend-foundation/prototypes/post-integrity.sql",
      "docs/backend-foundation/prototypes/core-listing-terms.sql",
      "docs/backend-foundation/prototypes/taxonomy-reference.sql",
      "docs/backend-foundation/prototypes/taxonomy-reference-seed.sql",
      "docs/backend-foundation/prototypes/post-search.sql",
      "docs/backend-foundation/prototypes/entitlements.sql",
      "docs/backend-foundation/prototypes/trust-governance.sql",
      "docs/backend-foundation/prototypes/publication.sql",
      "docs/backend-foundation/prototypes/listing-attributes.sql",
      "docs/backend-foundation/prototypes/moderation-queues.sql",
      "docs/backend-foundation/prototypes/operations-costs.sql",
      "docs/backend-foundation/prototypes/identity-verification.sql",
      "docs/backend-foundation/prototypes/fixture-core-drivers.sql",
      "docs/backend-foundation/prototypes/public-price-negotiable.sql",
      "src/lib/foundation/connection.ts",
      "src/lib/foundation/authenticated-api.ts",
      "src/lib/foundation/staff-identity.ts",
      "src/lib/supabase/fetch-with-timeout.ts",
      "database/foundation/api.types.ts",
      "database/foundation/api-role-types.ts",
      "src/lib/domains/verification/identity-fingerprint.ts",
      "src/lib/domains/verification/identity-processing.ts",
      "src/lib/utils/sa-id-validation.ts",
      "src/lib/constants/verification.ts",
      "src/lib/domains/taxonomy/reference.json",
      "src/lib/domains/listings/price.ts",
      "src/lib/domains/listings/price-terms.ts",
      "src/lib/domains/listings/price-form.ts",
      "src/lib/domains/listings/price-draft.ts",
      "src/types/enums.ts",
      "src/lib/domains/posts/identity.ts",
      "src/lib/domains/posts/listing-draft.ts",
    ].map((file) => [file, digest(file)])
  );
  const container = "supabase_db_backend-foundation-impl";
  assert.equal(config.project_id, "backend-foundation-impl");
  assert.equal(config.api.port, 55441);
  assert.equal(config.db.port, 55442);
  assert.deepEqual(config.api.schemas, ["api"]);
  const cli = (args) =>
    execFileSync(process.execPath, [cliPath, ...args, "--workdir", workdir], {
      encoding: "utf8",
      cwd: workdir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  const status = JSON.parse(cli(["status", "-o", "json"]));
  const url = new URL(status.API_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55441");
  assert.equal(url.protocol, "http:");
  const uuid = (value) => {
    assert.match(value, /^[a-f0-9-]{36}$/);
    return value;
  };
  const sql = (statement) =>
    execFileSync(
      "docker",
      [
        ...dockerArgs,
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
        "-At",
      ],
      { input: statement, encoding: "utf8", env, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
  const checks = [];
  const sqlFails = (statement, state) =>
    assert.throws(
      () => sql(statement),
      (error) => new RegExp(`ERROR:\\s+${state}:`).test(String(error.stderr))
    );
  const controlledSql = (statement, options) => {
    const child = spawn(
      "docker",
      [
        ...dockerArgs,
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
      ],
      { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );
    return controlNativeSqlChild(child, statement, options);
  };
  const record = (id, details = {}) => {
    checks.push({ id, status: "PASS", ...details });
    process.stdout.write(`${id}: PASS\n`);
  };
  const awaitQueuedRpc = async (name, minimumWaiters = 1) => {
    if (![1, 2].includes(minimumWaiters)) throw new Error("Invalid synthetic waiter count");
    if (
      ![
        "approve_decision",
        "withdraw_decision",
        "moderate_post",
        "discard_post_edit",
        "set_post_state",
        "reassign_queue_claim",
        "claim_queue_items",
        "claim_queue_item",
        "resolve_report",
        "create_post_edit",
        "delete_post",
        "grant_intro_trial",
        "close_account_evidence",
        "acknowledge_cost_alarm",
        "start_checkout",
        "apply_provider_event",
        "reverse_payment",
        "activate_post",
        "review_identity_submission",
        "begin_evidence_upload",
        "get_owner_listing_editor",
        "get_owner_business_event_editor",
        "save_business_event_context",
        "submit_post",
        "flag_duplicate_events",
        "preview_duplicate_events",
        "staff_review_report",
        "set_post_contacts",
        "get_owner_post_contacts",
        "get_owner_verification_readiness",
      ].includes(name)
    )
      throw new Error("Unknown synthetic RPC barrier");
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      // Count only; never expose query text or request/JWT settings.
      if (
        Number(
          sql(
            `select count(*) from pg_stat_activity where datname='postgres' and wait_event_type='Lock' and query like '%${name}%';`
          )
        ) >= minimumWaiters
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Synthetic first RPC did not queue on its lock");
  };
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        assert.equal(
          new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
            .origin,
          url.origin
        );
        return fetch(input, {
          ...init,
          redirect: "error",
          signal: init?.signal ?? AbortSignal.timeout(10000),
        });
      },
    },
  };
  const admin = createClient(status.API_URL, status.SECRET_KEY, options);
  const client = () => createClient(status.API_URL, status.PUBLISHABLE_KEY, options);
  const users = [];
  const resource = randomUUID();
  const job = randomUUID();
  const startedAt = new Date().toISOString();
  let exitCode = 0;
  let nativeStage = "unlabelled native assertion";
  let appliedFunctions = [];
  const createTrackedUser = async (label) => {
    const email = `foundation-${label}-${randomUUID()}@example.invalid`,
      password = randomBytes(24).toString("base64url");
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null);
    const tracked = { id: uuid(created.data.user.id), member: client(), token: null };
    users.push(tracked);
    const login = await tracked.member.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null);
    tracked.token = login.data.session.access_token;
    return tracked;
  };
  let verificationFixture;
  try {
    const { restoreListingPriceDraft, buildListingPriceDraftCommand } =
      await import("../src/lib/domains/listings/price-draft.ts");
    const { buildCoreDraftCommand, readCoreDraft } =
      await import("../src/lib/domains/posts/identity.ts");
    const { restoreCoreListingDraft, buildCoreListingTermsCommand } =
      await import("../src/lib/domains/posts/listing-draft.ts");
    const sourceSql = Object.entries(FIXTURE_MIGRATIONS)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, file]) => readFileSync(file, "utf8"))
      .join("\n");
    const expectedBodies = new Map(
      [
        ...sourceSql.matchAll(
          /create (?:or replace )?function ([\w.]+)\([^;]+?as \$\$([\s\S]*?)\$\$;/g
        ),
      ].map((match) => [match[1], match[2].replaceAll("\r\n", "\n").trim()])
    );
    const expectedSecurity = new Map(
      [...sourceSql.matchAll(/create (?:or replace )?function ([\w.]+)\(([^;]+?)as \$\$/g)].map(
        (match) => [match[1], /security definer/i.test(match[2])]
      )
    );
    const expectedVolatility = new Map(
      [...sourceSql.matchAll(/create (?:or replace )?function ([\w.]+)\(([^;]+?)as \$\$/g)].map(
        (match) => [
          match[1],
          /\bimmutable\b/i.test(match[2]) ? "i" : /\bstable\b/i.test(match[2]) ? "s" : "v",
        ]
      )
    );
    const actualFunctions = JSON.parse(
      sql(
        "select json_agg(json_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc,'owner',r.rolname,'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'public_execute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname in ('api','internal');"
      )
    );
    assert.equal(actualFunctions.length, expectedBodies.size);
    assert.ok(expectedBodies.size >= 184);
    for (const fn of actualFunctions) {
      assert.equal(fn.body.replaceAll("\r\n", "\n").trim(), expectedBodies.get(fn.name));
      assert.equal(fn.owner, "postgres");
      assert.equal(fn.public_execute, false);
      assert.deepEqual(fn.config, ["search_path=pg_catalog"]);
      assert.equal(fn.definer, expectedSecurity.get(fn.name));
      assert.equal(fn.volatility, expectedVolatility.get(fn.name));
    }
    appliedFunctions = actualFunctions.map(({ body, ...metadata }) => ({
      ...metadata,
      bodyHash: createHash("sha256").update(body).digest("base64url"),
    }));
    record("applied-function-bodies-owner-public-grants");
    for (const name of ["owner", "other", "search"]) {
      const email = `foundation-${name}-${randomUUID()}@example.invalid`;
      const password = randomBytes(24).toString("base64url");
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      assert.equal(created.error, null, "Local synthetic Auth creation failed");
      const tracked = { id: uuid(created.data.user.id), member: null, token: null };
      users.push(tracked); // Track before sign-in so failures still delete the account.
      const member = client();
      const login = await member.auth.signInWithPassword({ email, password });
      assert.equal(login.error, null, "Local sign-in failed");
      Object.assign(tracked, { member, token: login.data.session.access_token });
    }
    record("real-auth-modern-keys", {
      scope: "Local GoTrue; publishable and secret keys; three real sessions",
    });
    const [owner, other, searchOwner] = users;
    sql(
      `insert into private.transport_resources (id,owner_id,title,private_note) values ('${resource}','${owner.id}','Before','synthetic-private');`
    );
    const headers = (token, service = false) => ({
      apikey: service ? status.SECRET_KEY : status.PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      "Content-Profile": "api",
      "Accept-Profile": "api",
    });
    const rpc = async (name, body, token, service = false) => {
      const response = await fetch(`${status.API_URL}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: headers(token, service),
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      return { status: response.status, data: await response.json() };
    };
    const payload = { p_id: resource, p_revision: 1, p_title: "After" };
    const success = await rpc("rename_transport_resource", payload, owner.token);
    assert.equal(success.status, 200);
    assert.deepEqual(success.data, { id: resource, title: "After", revision: 2 });
    record("owner-dto");
    const foreign = await rpc(
      "rename_transport_resource",
      { ...payload, p_revision: 2 },
      other.token
    );
    assert.equal(foreign.status, 403);
    assert.equal(foreign.data.code, "42501");
    record("valid-other-owner-denial");
    const anonymous = await rpc("rename_transport_resource", { ...payload, p_revision: 2 });
    assert.equal(anonymous.status, 401);
    const machineOwner = await rpc(
      "rename_transport_resource",
      { ...payload, p_revision: 2 },
      null,
      true
    );
    assert.equal(machineOwner.status, 403);
    record("anon-machine-owner-command-denial");
    const injected = await rpc(
      "rename_transport_resource",
      { ...payload, p_actor: owner.id },
      other.token
    );
    assert.equal(injected.status, 404);
    assert.equal(injected.data.code, "PGRST202");
    const metadata = await other.member.auth.updateUser({
      data: { role: "admin", sub: owner.id, owner_id: owner.id },
    });
    assert.equal(metadata.error, null);
    const refreshed = await other.member.auth.refreshSession();
    assert.equal(refreshed.error, null);
    other.token = refreshed.data.session.access_token;
    const refreshedClaims = JSON.parse(
      Buffer.from(other.token.split(".")[1], "base64url").toString()
    );
    assert.equal(refreshedClaims.user_metadata.owner_id, owner.id);
    assert.equal(refreshedClaims.user_metadata.role, "admin");
    const metadataDenied = await rpc(
      "rename_transport_resource",
      { ...payload, p_revision: 2 },
      other.token
    );
    assert.equal(metadataDenied.status, 403);
    record("actor-argument-metadata-injection-denial");
    const anonymousClient = client();
    const anonymousLogin = await anonymousClient.auth.signInAnonymously();
    assert.equal(anonymousLogin.error, null);
    const trackedAnonymous = {
      id: uuid(anonymousLogin.data.user.id),
      member: anonymousClient,
      token: null,
    };
    users.push(trackedAnonymous);
    trackedAnonymous.token = anonymousLogin.data.session.access_token;
    const anonAuthDenied = await rpc(
      "rename_transport_resource",
      { ...payload, p_revision: 2 },
      anonymousLogin.data.session.access_token
    );
    assert.equal(anonAuthDenied.status, 403);
    assert.equal(anonAuthDenied.data.message, "authenticated member required");
    record("anonymous-auth-denial");
    const segments = owner.token.split(".");
    segments[2] = (segments[2][0] === "A" ? "B" : "A") + segments[2].slice(1);
    const tampered = await rpc(
      "rename_transport_resource",
      { ...payload, p_revision: 2 },
      segments.join(".")
    );
    assert.equal(tampered.status, 401);
    record("jwt-signature-denial");
    for (const schema of ["private", "internal"]) {
      for (const principal of [null, owner.token, "service"]) {
        const response = await fetch(
          `${status.API_URL}/rest/v1/transport_resources?select=private_note`,
          {
            headers: {
              ...headers(principal === "service" ? null : principal, principal === "service"),
              "Accept-Profile": schema,
            },
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          }
        );
        assert.equal(response.status, 406);
        assert.equal((await response.json()).code, "PGRST106");
      }
    }
    assert.equal(
      sql(
        "select bool_and(not has_any_column_privilege(r,'private.transport_resources','select,insert,update,references') and not has_table_privilege(r,'private.transport_resources','insert,update,delete,truncate,references,trigger')) from unnest(array['anon','authenticated','service_role']) r;"
      ),
      "t"
    );
    record("private-schema-http-and-column-denial");
    try {
      sql(
        "revoke execute on function internal.rename_transport_resource(uuid,integer,text) from authenticated;"
      );
      assert.equal(
        (await rpc("rename_transport_resource", { ...payload, p_revision: 2 }, owner.token)).status,
        403
      );
    } finally {
      sql(
        "grant execute on function internal.rename_transport_resource(uuid,integer,text) to authenticated;"
      );
    }
    try {
      sql("revoke usage on schema internal from authenticated;");
      assert.equal(
        (await rpc("rename_transport_resource", { ...payload, p_revision: 2 }, owner.token)).status,
        403
      );
    } finally {
      sql("grant usage on schema internal to authenticated;");
    }
    record("wrapper-helper-namespace-grants");
    const sdkOwner = await owner.member.schema("api").rpc("rename_transport_resource", {
      p_id: resource,
      p_revision: 2,
      p_title: "SDK owner",
    });
    assert.equal(sdkOwner.error, null);
    assert.equal(sdkOwner.data.revision, 3);
    record("supabase-client-custom-schema");
    const race = await Promise.all(
      ["First", "Second"].map((p_title) =>
        rpc("rename_transport_resource", { p_id: resource, p_revision: 3, p_title }, owner.token)
      )
    );
    assert.deepEqual(race.map((result) => result.status).sort(), [200, 403]);
    assert.equal(
      sql(`select revision from private.transport_resources where id='${resource}';`),
      "4"
    );
    record("native-concurrent-revision-fencing");
    assert.equal(
      (await rpc("enqueue_transport_reconciliation", { p_id: job }, owner.token)).status,
      403
    );
    for (let attempt = 0; attempt < 2; attempt++)
      assert.equal(
        (await rpc("enqueue_transport_reconciliation", { p_id: job }, null, true)).status,
        200
      );
    assert.equal(sql(`select count(*) from private.transport_jobs where id='${job}';`), "1");
    record("machine-contract-idempotency");
    const eventWindow = {
      starts_at: "2026-11-01T16:00:00Z",
      ends_at: "2026-11-01T18:00:00Z",
      timezone: "Africa/Johannesburg",
    };
    const contexts = [
      { kind: "listing", area: "market", category_key: "fixture_market" },
      { kind: "business", area: "business", category_key: "fixture_business" },
      { kind: "business", area: "tourism_events", category_key: "fixture_tourism_business" },
      { kind: "event", area: "tourism_events", category_key: "fixture_event" },
    ];
    const coreDrafts = [];
    for (const context of contexts) {
      const command = buildCoreDraftCommand({
        context,
        detail:
          context.kind === "event"
            ? { ...eventWindow, timezone: "africa/johannesburg", contact_channels: ["form"] }
            : context.kind === "listing"
              ? { contact_channels: ["form"] }
              : {},
      });
      const result = await rpc("create_core_draft", command, owner.token);
      assert.equal(result.status, 200);
      coreDrafts.push(readCoreDraft(result.data));
    }
    record("native-core-all-kind-area-pairs-and-exact-dto");
    const listingId = uuid(coreDrafts[0].id);
    assert.equal((await rpc("get_core_draft", { p_id: listingId }, other.token)).data, null);
    assert.deepEqual(
      (await rpc("get_core_draft", { p_id: listingId }, owner.token)).data,
      coreDrafts[0]
    );
    const createContext = {
      p_kind: "listing",
      p_area: "market",
      p_category_key: "fixture_market",
      p_detail: { contact_channels: ["form"] },
    };
    assert.equal((await rpc("create_core_draft", createContext)).status, 401);
    assert.equal((await rpc("create_core_draft", createContext, null, true)).status, 403);
    assert.equal(
      (await rpc("create_core_draft", createContext, trackedAnonymous.token)).status,
      403
    );
    assert.equal(
      (await rpc("create_core_draft", { ...createContext, p_owner_id: other.id }, owner.token))
        .status,
      404
    );
    assert.equal(
      (await rpc("create_core_draft", { ...createContext, p_status: "live" }, owner.token)).status,
      404
    );
    record("native-core-owner-and-authority-boundaries");
    for (const bad of [
      { ...createContext, p_area: "business" },
      {
        p_kind: "business",
        p_area: "business",
        p_category_key: "fixture_tourism_business",
        p_detail: {},
      },
      {
        p_kind: "business",
        p_area: "tourism_events",
        p_category_key: "fixture_event",
        p_detail: {},
      },
      { p_kind: "event", p_area: "tourism_events", p_category_key: "fixture_event", p_detail: {} },
      {
        p_kind: "event",
        p_area: "tourism_events",
        p_category_key: "fixture_event",
        p_detail: { ...eventWindow, form_version: 1 },
      },
      {
        p_kind: "event",
        p_area: "tourism_events",
        p_category_key: "fixture_event",
        p_detail: { ...eventWindow, timezone: "Moon/Base" },
      },
      {
        p_kind: "event",
        p_area: "tourism_events",
        p_category_key: "fixture_event",
        p_detail: { ...eventWindow, starts_at: "2026-11-01T16:00:00.000001Z" },
      },
      {
        p_kind: "event",
        p_area: "tourism_events",
        p_category_key: "fixture_event",
        p_detail: { ...eventWindow, starts_at: "2026-11-01T16:00Z" },
      },
    ])
      assert.equal((await rpc("create_core_draft", bad, owner.token)).status, 400);
    assert.equal(sql(`select count(*) from private.posts where owner_id='${owner.id}';`), "4");
    record("native-core-category-kind-area-and-event-requirements");
    const eventId = uuid(coreDrafts[3].id);
    sqlFails(
      `update private.event_details set ends_at=starts_at+interval '90 days 1 microsecond' where post_id='${eventId}';`,
      "23514"
    );
    sqlFails(
      `update private.event_details set timezone='Moon/Base' where post_id='${eventId}';`,
      "23503"
    );
    record("native-core-event-millisecond-and-zone-constraints");
    const missingDetail = randomUUID();
    const parentInsert = (id) =>
      `insert into private.posts(id,owner_id,kind,area,category_key) values('${id}','${owner.id}','listing','market','fixture_market');`;
    sqlFails(`begin; ${parentInsert(missingDetail)} commit;`, "23514");
    assert.equal(sql(`select count(*) from private.posts where id='${missingDetail}';`), "0");
    const wrongDetail = randomUUID();
    sqlFails(
      `begin; ${parentInsert(wrongDetail)} insert into private.business_details(post_id) values('${wrongDetail}'); commit;`,
      "23503"
    );
    sqlFails(`delete from private.listing_details where post_id='${listingId}';`, "23514");
    const movedDetail = randomUUID();
    sqlFails(
      `begin; ${parentInsert(movedDetail)} update private.listing_details set post_id='${movedDetail}' where post_id='${listingId}'; commit;`,
      "23514"
    );
    sqlFails("truncate private.listing_details;", "23514");
    sqlFails("truncate private.posts cascade;", "23514");
    const wrongCategory = randomUUID();
    sqlFails(
      `begin; insert into private.posts(id,owner_id,kind,area,category_key) values('${wrongCategory}','${owner.id}','business','business','fixture_tourism_business'); commit;`,
      "23503"
    );
    assert.equal(
      sql(`select count(*) from private.listing_details where post_id='${listingId}';`),
      "1"
    );
    record("native-core-commit-cardinality-type-delete-reparent-truncate");
    sqlFails(`update private.posts set owner_id='${other.id}' where id='${listingId}';`, "23514");
    sqlFails(`update private.posts set kind='business' where id='${listingId}';`, "23514");
    sqlFails(`update private.posts set area='business' where id='${listingId}';`, "23514");
    sqlFails(`delete from auth.users where id='${owner.id}';`, "23503");
    assert.equal(
      sql(
        "select bool_and(not has_any_column_privilege(r,t,'select,insert,update,references') and not has_table_privilege(r,t,'insert,update,delete,truncate,references,trigger')) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private.posts','private.post_category_contracts','private.listing_details','private.business_details','private.event_details','private.post_event_timezones']) t;"
      ),
      "t"
    );
    record("native-core-identity-and-account-deletion-restrictions");
    sql(`delete from private.posts where id='${listingId}';`);
    assert.equal(
      sql(`select count(*) from private.listing_details where post_id='${listingId}';`),
      "0"
    );
    assert.equal((await rpc("create_core_draft", createContext, owner.token)).status, 200);
    record("native-core-whole-post-detail-cascade");
    const capRace = await Promise.all(
      [1, 2].map(() => rpc("create_core_draft", createContext, owner.token))
    );
    assert.deepEqual(capRace.map((result) => result.status).sort(), [200, 429]);
    assert.equal(sql(`select count(*) from private.posts where owner_id='${owner.id}';`), "5");
    record("native-core-fixture-cap-concurrency");
    const unsupportedPriceId = uuid(capRace.find((result) => result.status === 200).data.id);
    assert.equal(
      (await rpc("get_core_listing_draft", { p_id: unsupportedPriceId }, owner.token)).data,
      null
    );
    assert.equal(
      (
        await rpc(
          "save_core_listing_terms",
          {
            p_id: unsupportedPriceId,
            p_expected_revision: 1,
            p_terms: { price: { mode: "free" } },
          },
          owner.token
        )
      ).status,
      409
    );
    const sharedIds = [];
    for (const category of ["electronics", "jobs_services"]) {
      const created = await rpc(
        "create_core_draft",
        buildCoreDraftCommand({
          context: { kind: "listing", area: "market", category_key: category },
          detail: { contact_channels: ["form"] },
        }),
        other.token
      );
      assert.equal(created.status, 200);
      sharedIds.push(uuid(created.data.id));
    }
    const sharedId = sharedIds[0];
    const sharedSave = (revision, terms, token = other.token, id = sharedId, service = false) =>
      rpc(
        "save_core_listing_terms",
        { p_id: id, p_expected_revision: revision, p_terms: terms },
        token,
        service
      );
    const unset = await rpc("get_core_listing_draft", { p_id: sharedId }, other.token);
    assert.equal(unset.status, 200);
    assert.equal(restoreCoreListingDraft(unset.data).form.mode, "");
    assert.deepEqual(
      Object.keys(unset.data).sort(),
      [
        "id",
        "kind",
        "area",
        "category_key",
        "status",
        "revision",
        "price_mode",
        "price_cents",
        "price_negotiable",
      ].sort()
    );
    let sharedRevision = 1;
    for (const form of [
      { mode: "amount", amount: "0.29", negotiable: true },
      { mode: "on_request", amount: "", negotiable: true },
      { mode: "free", amount: "", negotiable: false },
    ]) {
      const command = buildCoreListingTermsCommand({
        id: sharedId,
        category: "electronics",
        expected_revision: sharedRevision,
        form,
      });
      const saved = await rpc("save_core_listing_terms", command, other.token);
      assert.equal(saved.status, 200);
      sharedRevision++;
      const restored = restoreCoreListingDraft(saved.data);
      assert.deepEqual(restored.form, form);
      assert.equal(restored.expected_revision, sharedRevision);
      assert.equal(
        (await rpc("get_core_draft", { p_id: sharedId }, other.token)).data.revision,
        sharedRevision
      );
      assert.equal(
        (await rpc("get_core_listing_draft", { p_id: sharedId }, other.token)).data.price_mode,
        form.mode
      );
    }
    record("native-shared-listing-owner-form-terms-revision-roundtrip");
    const sharedBefore = sql(
      `select row_to_json(p)::text||row_to_json(d)::text from private.posts p join private.listing_details d on d.post_id=p.id where p.id='${sharedId}';`
    );
    for (const terms of [
      null,
      { price: { mode: "free" }, negotiable: true },
      { price: { mode: "on_request", amount_cents: 0 } },
      { price: { mode: "amount", amount_cents: 1.5 } },
      { price: { mode: "amount", amount_cents: 9999999901 } },
      { price: { mode: "on_request" }, negotiable: null },
      { price: { mode: "free" }, owner_id: owner.id },
    ])
      assert.equal((await sharedSave(sharedRevision, terms)).status, 400);
    assert.equal(
      sql(
        `select row_to_json(p)::text||row_to_json(d)::text from private.posts p join private.listing_details d on d.post_id=p.id where p.id='${sharedId}';`
      ),
      sharedBefore
    );
    assert.equal((await rpc("get_core_listing_draft", { p_id: sharedId }, owner.token)).data, null);
    assert.equal(
      (await sharedSave(sharedRevision, { price: { mode: "free" } }, owner.token)).status,
      409
    );
    assert.equal((await sharedSave(sharedRevision, { price: { mode: "free" } }, null)).status, 401);
    assert.equal(
      (await sharedSave(sharedRevision, { price: { mode: "free" } }, null, sharedId, true)).status,
      403
    );
    assert.equal(
      (await sharedSave(sharedRevision, { price: { mode: "free" } }, trackedAnonymous.token))
        .status,
      403
    );
    assert.equal(
      (
        await rpc(
          "save_core_listing_terms",
          {
            p_id: sharedId,
            p_expected_revision: sharedRevision,
            p_terms: { price: { mode: "free" } },
            p_owner: other.id,
          },
          other.token
        )
      ).status,
      404
    );
    assert.equal((await sharedSave(2147483647, { price: { mode: "free" } })).status, 400);
    record("native-shared-listing-malformed-authority-no-mutation");
    const sharedRace = await Promise.all(
      [false, true].map((negotiable) =>
        sharedSave(sharedRevision, { price: { mode: "on_request" }, negotiable })
      )
    );
    assert.deepEqual(sharedRace.map((r) => r.status).sort(), [200, 409]);
    sharedRevision++;
    assert.equal((await sharedSave(sharedRevision - 1, { price: { mode: "free" } })).status, 409);
    assert.equal(
      (await rpc("get_core_listing_draft", { p_id: sharedId }, other.token)).data.revision,
      sharedRevision
    );
    record("native-shared-listing-concurrent-whole-post-revision");
    for (const terms of [
      { price: { mode: "free" } },
      { price: { mode: "on_request" }, negotiable: true },
    ])
      assert.equal((await sharedSave(1, terms, other.token, sharedIds[1])).status, 400);
    assert.equal(
      (await sharedSave(1, { price: { mode: "on_request" } }, other.token, sharedIds[1])).status,
      200
    );
    sqlFails(
      `update private.listing_details set price_mode='free',price_cents=null where post_id='${sharedId}';`,
      "23514"
    );
    sqlFails(
      `update private.listing_details set price_mode='free',price_cents=0,price_negotiable=true where post_id='${sharedId}';`,
      "23514"
    );
    sqlFails(
      `update private.listing_details set price_mode='on_request',price_cents=null,price_negotiable=true where post_id='${sharedIds[1]}';`,
      "23514"
    );
    sql(
      `begin; update private.listing_details set price_mode='on_request',price_cents=null,price_negotiable=true where post_id='${sharedId}'; commit;`
    );
    sqlFails(
      `update private.posts set category_key='jobs_services' where id='${sharedId}';`,
      "23514"
    );
    sql(`update private.posts set status='pending_moderation' where id='${sharedId}';`);
    assert.equal((await rpc("get_core_listing_draft", { p_id: sharedId }, other.token)).data, null);
    assert.equal((await sharedSave(sharedRevision, { price: { mode: "free" } })).status, 409);
    sql(`update private.posts set status='draft' where id='${sharedId}';`);
    record("native-shared-listing-db-category-and-state-guards");
    const savePrice = (
      revision,
      terms,
      token = owner.token,
      category = "electronics",
      service = false
    ) =>
      rpc(
        "save_listing_price_draft",
        { p_expected_revision: revision, p_category_key: category, p_terms: terms },
        token,
        service
      );
    const amountTerms = { price: { mode: "amount", amount_cents: 9999999900 }, negotiable: true };
    const firstCommand = buildListingPriceDraftCommand({
      category: "electronics",
      expected_revision: 0,
      form: { mode: "amount", amount: "99999999.00", negotiable: true },
    });
    const firstPrice = await rpc("save_listing_price_draft", firstCommand, owner.token);
    assert.equal(firstPrice.status, 200);
    assert.equal(firstPrice.data.price_cents, 9999999900);
    assert.equal(firstPrice.data.revision, 1);
    assert.deepEqual(
      Object.keys(firstPrice.data).sort(),
      [
        "category_key",
        "expires_at",
        "price_cents",
        "price_mode",
        "price_negotiable",
        "revision",
      ].sort()
    );
    const restoredFirst = restoreListingPriceDraft(firstPrice.data);
    const freeCommand = buildListingPriceDraftCommand({
      category: restoredFirst.category,
      expected_revision: restoredFirst.expected_revision,
      form: { mode: "free", amount: "", negotiable: false },
    });
    const freePrice = await rpc("save_listing_price_draft", freeCommand, owner.token);
    assert.equal(freePrice.status, 200);
    assert.equal(freePrice.data.price_cents, 0);
    assert.equal(freePrice.data.price_negotiable, false);
    const requestPrice = await savePrice(2, { price: { mode: "on_request" }, negotiable: true });
    assert.equal(requestPrice.status, 200);
    assert.equal(requestPrice.data.price_cents, null);
    assert.equal(requestPrice.data.price_negotiable, true);
    assert.equal(requestPrice.data.revision, 3);
    record("native-price-mode-roundtrip-hidden-value-clearing");
    assert.equal(restoreListingPriceDraft(requestPrice.data).form.mode, "on_request");
    assert.equal(restoreListingPriceDraft(requestPrice.data).form.negotiable, true);
    record("native-price-form-rpc-dto-roundtrip");
    assert.equal((await rpc("read_listing_price_draft", {}, other.token)).data, null);
    const initialDraftRace = await Promise.all(
      ["free", "on_request"].map((mode) => savePrice(0, { price: { mode } }, other.token))
    );
    assert.deepEqual(initialDraftRace.map((result) => result.status).sort(), [200, 409]);
    record("native-price-concurrent-initial-draft");
    assert.equal(
      (await rpc("read_listing_price_draft", {}, owner.token)).data.price_mode,
      "on_request"
    );
    assert.equal(
      (
        await rpc(
          "save_listing_price_draft",
          {
            p_expected_revision: 3,
            p_category_key: "electronics",
            p_terms: amountTerms,
            p_owner: owner.id,
          },
          other.token
        )
      ).status,
      404
    );
    assert.equal((await savePrice(3, amountTerms, null)).status, 401);
    assert.equal((await savePrice(3, amountTerms, null, "electronics", true)).status, 403);
    assert.equal((await savePrice(0, amountTerms, trackedAnonymous.token)).status, 403);
    record("native-price-owner-machine-anonymous-boundaries");
    for (const bad of [
      null,
      { price: { mode: "amount", amount_cents: null } },
      { price: { mode: "amount", amount_cents: 0 } },
      { price: { mode: "amount", amount_cents: 1.5 } },
      { price: { mode: "amount", amount_cents: 9999999901 } },
      { price: { mode: "amount", amount_cents: "100" } },
      { price: { mode: "free", amount_cents: 0 } },
      { price: { mode: "on_request", amount_cents: null } },
      { price: { mode: "free" }, negotiable: true },
      { price: { mode: "free" }, negotiable: null },
      { price: { mode: "free" }, owner_id: owner.id },
      { price: { mode: null } },
    ])
      assert.equal((await savePrice(3, bad)).status, 400);
    assert.equal(
      (await savePrice(3, { price: { mode: "free" } }, owner.token, "jobs_services")).status,
      400
    );
    assert.equal((await savePrice(3, amountTerms, owner.token, "jobs_services")).status, 400);
    assert.equal(
      (
        await savePrice(
          3,
          { price: { mode: "on_request" }, negotiable: true },
          owner.token,
          "jobs_services"
        )
      ).status,
      400
    );
    assert.equal((await savePrice(3, amountTerms, owner.token, "invented")).status, 400);
    assert.equal((await rpc("read_listing_price_draft", {}, owner.token)).data.revision, 3);
    record("native-price-malformed-hidden-job-terms-no-mutation");
    const priceRace = await Promise.all(
      [false, true].map((negotiable) =>
        savePrice(3, { price: { mode: "amount", amount_cents: 29 }, negotiable })
      )
    );
    assert.deepEqual(priceRace.map((result) => result.status).sort(), [200, 409]);
    assert.equal((await savePrice(3, { price: { mode: "free" } })).status, 409);
    record("native-price-concurrent-stale-revision-fencing");
    assert.throws(() =>
      sql(
        `update private.listing_price_drafts set price_mode='free',price_cents=null where owner_id='${owner.id}';`
      )
    );
    assert.throws(() =>
      sql(
        `update private.listing_price_drafts set price_mode='amount',price_cents=null where owner_id='${owner.id}';`
      )
    );
    assert.throws(() =>
      sql(
        `update private.listing_price_drafts set price_mode='on_request',price_cents=0 where owner_id='${owner.id}';`
      )
    );
    assert.equal(
      sql(
        "select bool_and(not has_any_column_privilege(r,'private.listing_price_drafts','select,insert,update,references') and not has_table_privilege(r,'private.listing_price_drafts','insert,update,delete,truncate,references,trigger')) from unnest(array['anon','authenticated','service_role']) r;"
      ),
      "t"
    );
    record("native-price-table-check-and-column-denial");
    sql(
      `update private.listing_price_drafts set expires_at=statement_timestamp()-interval '1 second' where owner_id='${owner.id}';`
    );
    assert.equal((await rpc("read_listing_price_draft", {}, owner.token)).data, null);
    assert.equal((await savePrice(4, { price: { mode: "free" } })).status, 409);
    const expiredDraftRace = await Promise.all(
      ["free", "on_request"].map((mode) => savePrice(0, { price: { mode } }))
    );
    assert.deepEqual(expiredDraftRace.map((result) => result.status).sort(), [200, 409]);
    const freshDraft = expiredDraftRace.find((result) => result.status === 200);
    assert.equal(freshDraft.status, 200);
    assert.equal(freshDraft.data.revision, 5);
    assert.equal(
      sql(`select count(*) from private.listing_price_drafts where owner_id='${owner.id}';`),
      "1"
    );
    record("native-price-expiry-and-monotonic-reset");
    const ownerClaims = JSON.parse(Buffer.from(owner.token.split(".")[1], "base64url").toString());
    const ownerSessionId = uuid(ownerClaims.session_id);
    assert.equal(
      sql(`select not_after is null from auth.sessions where id='${ownerSessionId}';`),
      "t"
    );
    try {
      sql(
        `update auth.sessions set not_after=statement_timestamp()-interval '1 second' where id='${ownerSessionId}';`
      );
      const expiredSession = await rpc("read_listing_price_draft", {}, owner.token);
      assert.equal(expiredSession.status, 403);
      assert.equal(expiredSession.data.message, "live session required");
      assert.equal(
        (await sharedSave(sharedRevision, { price: { mode: "free" } }, owner.token)).status,
        403
      );
    } finally {
      sql(`update auth.sessions set not_after=null where id='${ownerSessionId}';`);
    }
    record("native-price-expired-session-denial");
    const loggedOut = await owner.member.auth.signOut({ scope: "global" });
    assert.equal(loggedOut.error, null);
    assert.equal(
      (
        await rpc(
          "rename_transport_resource",
          { p_id: resource, p_revision: 4, p_title: "Revoked" },
          owner.token
        )
      ).status,
      403
    );
    record("revoked-real-session-stale-jwt-denial");
    assert.equal((await rpc("read_listing_price_draft", {}, owner.token)).status, 403);
    assert.equal((await savePrice(5, { price: { mode: "on_request" } })).status, 403);
    assert.equal(
      (await sharedSave(sharedRevision, { price: { mode: "free" } }, owner.token)).status,
      403
    );
    record("native-price-revoked-session-denial");
    // BF-06: reference catalogue parity, private reference tables, activity integrity and
    // database-side search semantics beyond the legacy 10,000-row in-memory cap.
    const referenceRaw = readFileSync("src/lib/domains/taxonomy/reference.json");
    const reference = JSON.parse(referenceRaw);
    const catalogue = await rpc("reference_catalog", {}, null);
    assert.equal(catalogue.status, 200);
    assert.equal(catalogue.data.version, reference.version);
    assert.equal(
      catalogue.data.content_hash,
      createHash("sha256").update(referenceRaw).digest("base64url")
    );
    assert.deepEqual(
      catalogue.data.categories.map((c) => [c.key, c.kind, c.area, c.activity_required]),
      reference.categories.map((c) => [c.key, c.kind, c.area, c.activityRequired])
    );
    assert.deepEqual(
      catalogue.data.activities.map((a) => [a.category, a.key, a.field_group ?? null]),
      reference.activities.map((a) => [a.category, a.key, a.fieldGroup ?? null])
    );
    assert.deepEqual(
      catalogue.data.cities.map((c) => [c.id, c.province]),
      reference.cities.map((c) => [c.id, c.province])
    );
    assert.deepEqual(
      catalogue.data.fields.map((f) => [f.category, f.key, f.renderer, f.required]),
      reference.listingFields.map((f) => [f.category, f.key, f.renderer, f.required])
    );
    record("native-taxonomy-reference-parity", {
      categories: reference.categories.length,
      activities: reference.activities.length,
      cities: reference.cities.length,
      fields: reference.listingFields.length,
    });
    const referenceTables = [
      "private.reference_catalog_versions",
      "private.categories",
      "private.category_activities",
      "private.provinces",
      "private.cities",
      "private.city_aliases",
      "private.category_fields",
      "private.post_search_documents",
    ];
    assert.equal(
      sql(
        `select bool_and(not has_table_privilege(r,t,'select,insert,update,delete,truncate,references,trigger')) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[${referenceTables.map((t) => `'${t}'`).join(",")}]) t;`
      ),
      "t"
    );
    const directRead = await fetch(`${status.API_URL}/rest/v1/categories?select=key`, {
      headers: { ...headers(null), "Accept-Profile": "private" },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(directRead.status, 406);
    await directRead.body?.cancel();
    record("native-taxonomy-private-tables-denied");
    const tourismPost = randomUUID();
    sqlFails(
      `begin; insert into private.posts(id,owner_id,kind,area,category_key) values('${tourismPost}','${other.id}','business','tourism_events','tourism_hospitality'); rollback;`,
      "23514"
    );
    const foreignActivity = reference.activities.find(
      (a) => a.category === "automotive_services"
    ).key;
    sqlFails(
      `begin; insert into private.posts(id,owner_id,kind,area,category_key,activity_key) values('${tourismPost}','${other.id}','business','tourism_events','tourism_hospitality','${foreignActivity}'); rollback;`,
      "23503"
    );
    const tourismActivity = reference.activities.find(
      (a) => a.category === "tourism_hospitality"
    ).key;
    sql(
      `begin; insert into private.posts(id,owner_id,kind,area,category_key,activity_key) values('${tourismPost}','${other.id}','business','tourism_events','tourism_hospitality','${tourismActivity}'); insert into private.business_details(post_id) values('${tourismPost}'); rollback;`
    );
    record("native-taxonomy-activity-integrity");

    const SEARCH_ROWS = 10050;
    const choice = reference.listingFields.find(
      (f) =>
        f.category === "electronics" && f.renderer === "select" && f.optionAuthority === "closed"
    );
    const choiceValue = choice.validation.enum[0];
    const range = reference.listingFields.find(
      (f) => f.category === "electronics" && f.renderer === "number"
    );
    // Groups of three posts share a timestamp so the id tie-breaker is exercised. Only the
    // two oldest electronics posts carry the choice facet, so finding them proves filters are
    // not limited to a newest-rows window. Post 4 is expired and post 5 hidden.
    sql(`begin;
insert into private.posts(id,owner_id,kind,area,category_key,status,published_at,visible_until)
  select md5('bf06-'||g)::uuid,'${searchOwner.id}','listing','market',case when g%3=0 then 'vehicles' else 'electronics' end,'live',statement_timestamp(),statement_timestamp()+interval '30 days' from generate_series(1,${SEARCH_ROWS}) g;
insert into private.listing_details(post_id) select md5('bf06-'||g)::uuid from generate_series(1,${SEARCH_ROWS}) g;
insert into private.entitlements(id,owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
  select md5('bf06-ent-'||g)::uuid,'${searchOwner.id}','staff_grant','${other.id}',1000,10,1,statement_timestamp(),statement_timestamp()+interval '30 days' from generate_series(0,${Math.floor(SEARCH_ROWS / 1000)}) g;
insert into private.post_activations(post_id,entitlement_id,owner_id)
  select md5('bf06-'||g)::uuid,md5('bf06-ent-'||(g/1000))::uuid,'${searchOwner.id}' from generate_series(1,${SEARCH_ROWS}) g;
insert into private.post_search_documents(post_id,kind,area,category_key,province_id,city_id,locality_label,title,summary,price_mode,price_cents,published_at,visible_until,is_visible,facets)
  select md5('bf06-'||g)::uuid,'listing','market',case when g%3=0 then 'vehicles' else 'electronics' end,'gp',
    case when g%2=0 then 'gp_johannesburg' end,case when g%2=0 then 'Johannesburg' else 'Midrand' end,
    case when g%10=0 then 'Samsung Galaxy '||g else 'Synthetic item '||g end,'Synthetic fixture text',
    case when g%7=0 then 'free' when g%11=0 then 'on_request' else 'amount' end,
    case when g%7=0 then 0 when g%11=0 then null else g*100 end,
    timestamptz '2026-01-01 00:00:00+00' + (g/3) * interval '1 minute',
    case when g=4 then statement_timestamp() - interval '1 day' end,
    g<>5,
    case when g<=3 and g%3<>0 then jsonb_build_object('${choice.key}','${choiceValue}','${range.key}',g*10)
      when g%3<>0 then jsonb_build_object('${range.key}',g*10) else '{}'::jsonb end
      || case when g<=5 then '{"condition":"good"}'::jsonb else '{}'::jsonb end
  from generate_series(1,${SEARCH_ROWS}) g;
commit;`);
    // Bulk fixture inserts bypass normal time for autovacuum's asynchronous
    // statistics refresh. Prepare deterministic planner statistics; keep the
    // real API timeout and all current eligibility/count/facet checks intact.
    sql(
      "analyze private.posts,private.post_search_documents,private.entitlements,private.post_activations;"
    );
    const search = (request) => rpc("search_posts", { p_request: request }, null);
    const visibleCount = SEARCH_ROWS - 2;
    const conditionPages = [];
    let conditionCursor = null;
    do {
      const page = await search({
        condition: "good",
        limit: 1,
        ...(conditionCursor ? { cursor: conditionCursor } : {}),
      });
      assert.equal(page.status, 200);
      assert.equal(page.data.total, 3);
      assert.deepEqual(page.data.facets.categories, { electronics: 2, vehicles: 1 });
      assert.ok(page.data.items.every((item) => item.condition === "good"));
      conditionPages.push(...page.data.items.map((item) => item.id));
      if (page.data.next_cursor)
        assert.equal(
          (await search({ condition: "fair", limit: 1, cursor: page.data.next_cursor })).status,
          400
        );
      conditionCursor = page.data.next_cursor;
    } while (conditionCursor);
    assert.equal(new Set(conditionPages).size, 3);
    assert.equal(conditionPages.length, 3);
    const categoryCondition = await search({ condition: "good", category: "electronics" });
    assert.equal(categoryCondition.data.total, 2);
    assert.deepEqual(categoryCondition.data.facets.categories, { electronics: 2, vehicles: 1 });
    assert.equal(
      (
        await search({
          condition: "good",
          category: "electronics",
          attributes: { condition: "good" },
        })
      ).data.total,
      2
    );
    assert.equal(
      (
        await search({
          condition: "good",
          category: "electronics",
          attributes: { condition: "fair" },
        })
      ).status,
      400
    );
    for (const condition of [null, "", "used", "refurbished", "Good", " good ", 1])
      assert.equal((await search({ condition })).status, 400);
    record("native-listing-global-condition-filter-counts-facets-and-cursor");
    const all = await search({ limit: 48 });
    assert.equal(all.status, 200);
    assert.equal(all.data.total, visibleCount);
    assert.equal(
      Object.values(all.data.facets.categories).reduce((sum, n) => sum + n, 0),
      visibleCount
    );
    const hiddenIds = JSON.parse(
      sql(`select json_agg(md5('bf06-'||g)::uuid) from unnest(array[4,5]) g;`)
    );
    const seen = new Set();
    let previous = null;
    let cursor = null;
    let pages = 0;
    do {
      const page = await search({ category: "vehicles", limit: 48, ...(cursor ? { cursor } : {}) });
      assert.equal(page.status, 200);
      for (const item of page.data.items) {
        assert.equal(seen.has(item.id), false, "duplicate across pages");
        seen.add(item.id);
        const key = [Date.parse(item.published_at), item.id];
        if (previous)
          assert.ok(
            key[0] < previous[0] || (key[0] === previous[0] && key[1] < previous[1]),
            "keyset order"
          );
        previous = key;
      }
      cursor = page.data.next_cursor;
      pages += 1;
    } while (cursor);
    const vehicles = Math.floor(SEARCH_ROWS / 3);
    assert.equal(seen.size, vehicles);
    assert.equal(pages, Math.ceil(vehicles / 48));
    for (const id of hiddenIds) assert.equal(seen.has(id), false);
    const oldest = await search({
      category: "electronics",
      attributes: { [choice.key]: choiceValue },
    });
    assert.equal(oldest.status, 200);
    assert.equal(oldest.data.total, 2);
    record("native-search-keyset-visibility-beyond-legacy-cap", {
      rows: SEARCH_ROWS,
      vehiclePages: pages,
    });
    const text = await search({ q: "sams GAL", limit: 48 });
    assert.equal(text.status, 200);
    assert.equal(text.data.total, Math.floor(SEARCH_ROWS / 10));
    assert.ok(text.data.items.every((item) => item.title.startsWith("Samsung Galaxy")));
    assert.equal((await search({ q: "samsung absentterm" })).data.total, 0);
    const scoped = await search({ q: "samsung", category: "electronics" });
    assert.equal(scoped.data.total, scoped.data.facets.categories.electronics);
    assert.ok(scoped.data.facets.categories.vehicles > 0);
    const priced = await search({
      category: "electronics",
      price_mode: "amount",
      min_price_cents: 100000,
      max_price_cents: 200000,
      limit: 48,
    });
    assert.equal(priced.status, 200);
    assert.ok(priced.data.total > 0);
    assert.ok(
      priced.data.items.every(
        (item) =>
          item.price_mode === "amount" &&
          BigInt(item.price_cents) >= 100000n &&
          BigInt(item.price_cents) <= 200000n
      )
    );
    const ranged = await search({
      category: "electronics",
      attributes: { [range.key]: { min: 100, max: 200 } },
      limit: 48,
    });
    assert.equal(ranged.status, 200);
    assert.equal(
      ranged.data.total,
      Number(sql(`select count(*) from generate_series(10,20) g where g%3<>0;`))
    );
    const locality = await search({
      province: "gp",
      city: "gp_johannesburg",
      category: "vehicles",
    });
    assert.equal(locality.data.total, Math.floor(SEARCH_ROWS / 6));
    record("native-search-text-price-attribute-locality-facets");
    for (const invalid of [
      { unknown: "x" },
      { attributes: { [choice.key]: choiceValue } },
      { category: "electronics", attributes: { not_a_field: "x" } },
      { category: "electronics", attributes: { [choice.key]: "not-a-choice" } },
      { category: "electronics", attributes: { brand: "Samsung" } },
      { min_price_cents: 1 },
      { price_mode: "free", max_price_cents: 10 },
      { city: "gp_johannesburg" },
      { province: "wc", city: "gp_johannesburg" },
      { category: "events", area: "market" },
      { activity: tourismActivity },
      { limit: 49 },
      { q: "a b c d e f g h i" },
      { cursor: "not-a-cursor" },
      { category: "electronics", cursor: all.data.next_cursor },
      { sort: "relevance" },
      { q: "samsung", sort: "popular" },
    ]) {
      const rejected = await search(invalid);
      assert.equal(rejected.status, 400, JSON.stringify(Object.keys(invalid)));
    }
    record("native-search-rejects-unknown-and-mismatched-filters");
    // DEC-23: typo tolerance, relevance blended with freshness, stable relevance paging.
    const typo = await search({ q: "samsng galxy", limit: 48 });
    assert.equal(typo.status, 200);
    assert.equal(typo.data.sort, "relevance");
    assert.equal(typo.data.total, Math.floor(SEARCH_ROWS / 10));
    assert.ok(typo.data.items.every((item) => item.title.startsWith("Samsung Galaxy")));
    const ranked = await search({ q: "samsung", limit: 48 });
    assert.equal(ranked.data.items[0].title, `Samsung Galaxy ${SEARCH_ROWS}`);
    const newest = await search({ q: "samsung", sort: "newest", limit: 48 });
    assert.equal(newest.data.sort, "newest");
    assert.equal(newest.data.items[0].score, null);
    const rankedSeen = new Set();
    let lastRank = null;
    let rankCursor = null;
    let rankPages = 0;
    do {
      const page = await search({
        q: "samsung",
        limit: 48,
        ...(rankCursor ? { cursor: rankCursor } : {}),
      });
      assert.equal(page.status, 200);
      for (const item of page.data.items) {
        assert.equal(rankedSeen.has(item.id), false, "duplicate across relevance pages");
        rankedSeen.add(item.id);
        const key = [Number(item.score), Date.parse(item.published_at), item.id];
        if (lastRank)
          assert.ok(
            key[0] < lastRank[0] ||
              (key[0] === lastRank[0] &&
                (key[1] < lastRank[1] || (key[1] === lastRank[1] && key[2] < lastRank[2]))),
            "relevance keyset order"
          );
        lastRank = key;
      }
      if (rankPages === 0) {
        // A post published mid-browse must not shift later pages of this search.
        const late = randomUUID();
        sql(
          `begin; insert into private.posts(id,owner_id,kind,area,category_key,status,published_at,visible_until) values('${late}','${searchOwner.id}','listing','market','electronics','live',statement_timestamp(),statement_timestamp()+interval '30 days'); insert into private.listing_details(post_id) values('${late}'); insert into private.post_activations(post_id,entitlement_id,owner_id) values('${late}',md5('bf06-ent-${Math.floor(SEARCH_ROWS / 1000)}')::uuid,'${searchOwner.id}'); insert into private.post_search_documents(post_id,kind,area,category_key,province_id,locality_label,title,price_mode,price_cents,published_at,is_visible) values('${late}','listing','market','electronics','gp','Midrand','Samsung Galaxy late','amount',100,statement_timestamp(),true); commit;`
        );
        rankedSeen.add(`late:${late}`);
      }
      rankCursor = page.data.next_cursor;
      rankPages += 1;
    } while (rankCursor);
    assert.equal(rankedSeen.size, Math.floor(SEARCH_ROWS / 10) + 1);
    assert.equal(rankPages, Math.ceil(Math.floor(SEARCH_ROWS / 10) / 48));
    assert.equal((await search({ q: "samsung" })).data.total, Math.floor(SEARCH_ROWS / 10) + 1);
    record("native-search-typo-relevance-freshness-and-stable-paging", {
      relevancePages: rankPages,
    });
    // BF-07: server-priced checkout, idempotent provider inbox, atomic fulfilment,
    // capacity-locked activation under concurrency, add-on windows, reversal and trials.
    const billing = await rpc("billing_catalogue", {}, null);
    assert.equal(billing.status, 200);
    const starter = billing.data.plans.find((plan) => plan.code === "market_30d");
    assert.equal(billing.data.plans.length, 17);
    const boost = billing.data.addons.find((addon) => addon.kind === "boost");
    assert.equal(starter.price_cents, "5000");
    assert.equal(boost.price_cents, "1500");
    assert.equal((await rpc("start_checkout", { p_product_id: starter.id }, null)).status, 401);
    const checkout = await rpc("start_checkout", { p_product_id: starter.id }, other.token);
    assert.equal(checkout.status, 200);
    assert.equal(checkout.data.amount_cents, "5000");
    assert.equal(checkout.data.reused, false);
    const again = await rpc("start_checkout", { p_product_id: starter.id }, other.token);
    assert.equal(again.data.payment_id, checkout.data.payment_id);
    assert.equal(again.data.reused, true);
    for (const [name, body] of [
      ["apply_provider_event", { p_event: {} }],
      ["attach_provider_request", { p_payment_id: checkout.data.payment_id, p_request_id: "x" }],
      [
        "reverse_payment",
        { p_payment_id: checkout.data.payment_id, p_kind: "refunded", p_reason: "member attempt" },
      ],
      ["grant_intro_trial", { p_owner: other.id, p_identity_hmac: "x", p_days: 7 }],
    ])
      assert.equal((await rpc(name, body, other.token)).status, 403, name);
    assert.equal(
      (
        await rpc(
          "attach_provider_request",
          { p_payment_id: checkout.data.payment_id, p_request_id: "bf07-req-1" },
          null,
          true
        )
      ).status,
      200
    );
    const providerEvent = (overrides = {}) => ({
      payload_sha256: createHash("sha256").update(randomUUID()).digest("hex"),
      merchant_reference: checkout.data.merchant_reference,
      provider_request_id: "bf07-req-1",
      provider_transaction_id: "bf07-txn-1",
      status: "complete",
      amount_cents: 5000,
      currency: "ZAR",
      ...overrides,
    });
    const apply = async (event) => {
      const result = await rpc("apply_provider_event", { p_event: event }, null, true);
      assert.equal(result.status, 200);
      return result.data.outcome;
    };
    const paymentState = () =>
      sql(
        `select status||':'||(select count(*) from private.entitlements e where e.payment_id=p.id)||':'||(select count(*) from private.invoices i where i.payment_id=p.id)||':'||(select count(*) from private.outbox_events o where o.subject_id=p.id) from private.payments p where p.id='${uuid(checkout.data.payment_id)}';`
      );
    assert.equal(await apply(providerEvent({ amount_cents: 100 })), "amount_mismatch");
    assert.equal(
      await apply(providerEvent({ provider_request_id: "bf07-other" })),
      "request_mismatch"
    );
    assert.equal(
      await apply(providerEvent({ merchant_reference: "bf07-unknown" })),
      "unknown_reference"
    );
    assert.equal(await apply(providerEvent({ status: "pending" })), "no_change");
    assert.equal(paymentState(), "pending:0:0:0");
    const completion = providerEvent();
    assert.equal(await apply(completion), "completed");
    assert.equal(paymentState(), "complete:1:1:1");
    assert.equal(await apply(completion), "duplicate_event");
    assert.equal(await apply(providerEvent()), "already_complete");
    assert.equal(
      await apply(providerEvent({ provider_transaction_id: "bf07-txn-2" })),
      "conflicting_transaction"
    );
    assert.equal(
      await apply(providerEvent({ status: "cancelled", provider_transaction_id: "" })),
      "late_status_ignored"
    );
    assert.equal(paymentState(), "complete:1:1:1");
    assert.equal(
      sql(
        `select vat_cents||'/'||total_cents from private.invoices where payment_id='${uuid(checkout.data.payment_id)}';`
      ),
      "652/5000"
    );
    record("native-billing-checkout-and-idempotent-provider-inbox");

    const livePosts = Array.from({ length: 4 }, () => randomUUID());
    sql(
      `begin; insert into private.posts(id,owner_id,kind,area,category_key,status,published_at,visible_until) values ${livePosts.map((id) => `('${id}','${other.id}','listing','market','electronics','live',statement_timestamp(),statement_timestamp()+interval '30 days')`).join(",")}; insert into private.listing_details(post_id) values ${livePosts.map((id) => `('${id}')`).join(",")}; commit;`
    );
    const raced = await Promise.all(
      livePosts.map((id) => rpc("activate_post", { p_post_id: id }, other.token))
    );
    assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409, 409, 409]);
    const activated = livePosts.filter((_, i) => raced[i].status === 200);
    const waiting = livePosts.filter((_, i) => raced[i].status === 409);
    assert.equal(
      (await rpc("activate_post", { p_post_id: activated[0] }, other.token)).data.reused,
      true
    );
    const capacity = await rpc("my_posting_capacity", {}, other.token);
    assert.equal(capacity.data.capacity, 1);
    assert.equal(capacity.data.active, 1);
    assert.equal((await rpc("release_post", { p_post_id: activated[0] }, other.token)).status, 400);
    assert.equal(
      (
        await rpc(
          "set_post_state",
          { p_post_id: activated[0], p_expected_revision: 1, p_action: "pause" },
          other.token
        )
      ).status,
      200
    );
    assert.equal(sql(`select status from private.posts where id='${activated[0]}';`), "paused");
    const releasedSnapshot = sql(
      `select jsonb_agg(to_jsonb(a) order by a.id)::text from private.post_activations a where post_id='${activated[0]}';`
    );
    for (let retry = 0; retry < 2; retry++) {
      const released = await rpc("release_post", { p_post_id: activated[0] }, other.token);
      assert.equal(released.status, 200);
      assert.equal(released.data, false);
      assert.equal(
        sql(
          `select jsonb_agg(to_jsonb(a) order by a.id)::text from private.post_activations a where post_id='${activated[0]}';`
        ),
        releasedSnapshot
      );
    }
    record("native-billing-no-active-release-is-false-without-mutation");
    assert.equal((await rpc("activate_post", { p_post_id: waiting[0] }, other.token)).status, 200);
    record("native-billing-capacity-race-and-release", {
      concurrent: livePosts.length,
      capacity: 1,
    });

    const billingEvents = [];
    const billingActivity = sql(
      "select key from private.category_activities where category_key='events' order by key limit 1;"
    );
    assert.match(billingActivity, /^[a-z_]+$/);
    const billingEventFixture = (postOwner = other.id) => {
      const id = randomUUID();
      billingEvents.push(id);
      sql(
        `begin; insert into private.posts(id,owner_id,kind,area,category_key,activity_key,status,published_at,visible_until) values('${id}','${uuid(postOwner)}','event','tourism_events','events','${billingActivity}','live',statement_timestamp(),statement_timestamp()+interval '3 days'); insert into private.event_details(post_id,starts_at,ends_at,timezone) values('${id}',date_trunc('second',statement_timestamp())+interval '2 days',date_trunc('second',statement_timestamp())+interval '3 days','Africa/Johannesburg'); commit;`
      );
      return id;
    };
    const addonTarget = billingEventFixture();
    const freeAddonTarget = billingEventFixture(searchOwner.id);
    for (const [id, token] of [
      [addonTarget, other.token],
      [freeAddonTarget, searchOwner.token],
    ])
      assert.equal(
        (await rpc("start_checkout", { p_product_id: boost.id, p_target_post: id }, token)).status,
        403
      );
    record("native-addon-capability-free-and-wrong-area-denied");
    const tourismPlan = billing.data.plans.find((p) => p.code === "tourism_30d");
    const tourismFunding = await rpc(
      "start_checkout",
      { p_product_id: tourismPlan.id },
      other.token
    );
    assert.equal(tourismFunding.status, 200);
    assert.equal(
      (
        await rpc(
          "attach_provider_request",
          { p_payment_id: tourismFunding.data.payment_id, p_request_id: "cap-tourism" },
          null,
          true
        )
      ).status,
      200
    );
    assert.equal(
      await apply(
        providerEvent({
          merchant_reference: tourismFunding.data.merchant_reference,
          provider_request_id: "cap-tourism",
          provider_transaction_id: "cap-tourism-txn",
        })
      ),
      "completed"
    );
    const tourismEntitlement = uuid(
      sql(
        `select id from private.entitlements where payment_id='${tourismFunding.data.payment_id}';`
      )
    );
    const pendingBefore = sql(
      `select count(*) from private.payments where owner_id='${other.id}' and status='pending';`
    );
    for (const addon of billing.data.addons.filter(
      (a) => a.kind === "boost" || a.kind === "featured"
    )) {
      assert.equal(
        (
          await rpc(
            "start_checkout",
            { p_product_id: addon.id, p_target_post: waiting[0] },
            other.token
          )
        ).status,
        400
      );
    }
    assert.equal(
      sql(
        `select count(*) from private.payments where owner_id='${other.id}' and status='pending';`
      ),
      pendingBefore
    );
    const urgent = billing.data.addons.find((a) => a.kind === "urgent");
    assert.equal(
      (
        await rpc(
          "start_checkout",
          { p_product_id: urgent.id, p_target_post: waiting[0] },
          other.token
        )
      ).status,
      200
    );
    record("native-billing-event-only-boost-featured-and-urgent-listing");
    const addonCheckout = await rpc(
      "start_checkout",
      { p_product_id: boost.id, p_target_post: addonTarget },
      other.token
    );
    assert.equal(addonCheckout.status, 200);
    const foreignPost = randomUUID();
    sql(
      `begin; insert into private.posts(id,owner_id,kind,area,category_key,status,published_at,visible_until) values('${foreignPost}','${owner.id}','listing','market','electronics','live',statement_timestamp(),statement_timestamp()+interval '30 days'); insert into private.listing_details(post_id) values('${foreignPost}'); commit;`
    );
    assert.equal(
      (
        await rpc(
          "start_checkout",
          { p_product_id: boost.id, p_target_post: foreignPost },
          other.token
        )
      ).status,
      400
    );
    const payAddon = async (payment, request, txn) => {
      assert.equal(
        (
          await rpc(
            "attach_provider_request",
            { p_payment_id: payment.payment_id, p_request_id: request },
            null,
            true
          )
        ).status,
        200
      );
      return apply({
        payload_sha256: createHash("sha256").update(randomUUID()).digest("hex"),
        merchant_reference: payment.merchant_reference,
        provider_request_id: request,
        provider_transaction_id: txn,
        status: "complete",
        amount_cents: 1500,
        currency: "ZAR",
      });
    };
    assert.equal(await payAddon(addonCheckout.data, "bf07-req-2", "bf07-txn-3"), "completed");
    const secondAddon = await rpc(
      "start_checkout",
      { p_product_id: boost.id, p_target_post: addonTarget },
      other.token
    );
    assert.notEqual(secondAddon.data.payment_id, addonCheckout.data.payment_id);
    assert.equal(await payAddon(secondAddon.data, "bf07-req-3", "bf07-txn-4"), "completed");
    assert.equal(
      sql(
        `select bool_and(stacked) from (select starts_at = lag(ends_at) over (order by starts_at) or lag(ends_at) over (order by starts_at) is null as stacked from private.post_addon_windows where post_id='${addonTarget}') w;`
      ),
      "t"
    );
    assert.equal(
      sql(
        `select round(extract(epoch from max(ends_at)-min(starts_at))/86400) from private.post_addon_windows where post_id='${addonTarget}';`
      ),
      "14"
    );
    record("native-billing-addon-windows-stack-and-ownership");

    const billingClaimsLiteral = JSON.stringify(refreshedClaims).replaceAll("'", "''");
    const ownerSql = (action) =>
      `set local role authenticated; do $test$ begin perform set_config('request.jwt.claims','${billingClaimsLiteral}',true); ${action} end $test$;`;
    const heldAction = (action) =>
      controlledSql(`begin; ${action} select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); commit;`);
    const deleteBillingPost = (id) =>
      rpc("delete_post", { p_post_id: id, p_expected_revision: 1 }, other.token);
    const newAddonPayment = async (id, token = other.token, product = boost) => {
      const checkoutResult = await rpc(
        "start_checkout",
        { p_product_id: product.id, p_target_post: id },
        token
      );
      assert.equal(checkoutResult.status, 200);
      const request = `request-${randomUUID()}`;
      assert.equal(
        (
          await rpc(
            "attach_provider_request",
            { p_payment_id: checkoutResult.data.payment_id, p_request_id: request },
            null,
            true
          )
        ).status,
        200
      );
      return {
        payment: checkoutResult.data,
        event: providerEvent({
          merchant_reference: checkoutResult.data.merchant_reference,
          provider_request_id: request,
          provider_transaction_id: `txn-${randomUUID()}`,
          amount_cents: Number(checkoutResult.data.amount_cents),
        }),
      };
    };
    const historicalPayment = (id) =>
      sql(
        `select target_post_id||':'||status||':'||fulfillment_status||':'||(select count(*) from private.invoices i where i.payment_id=p.id)||':'||(select count(*) from private.post_addon_windows w where w.payment_id=p.id)||':'||(select count(*) from private.outbox_events o where o.subject_id=p.id and o.kind='payment_reconciliation_required') from private.payments p where p.id='${uuid(id)}';`
      );
    const quoteBefore = sql(
      `select snapshot::text from private.payments where id='${addonCheckout.data.payment_id}';`
    );
    assert.deepEqual(JSON.parse(quoteBefore), {
      kind: "addon",
      addon: "boost",
      version: 1,
      days: 7,
      price_cents: 1500,
      target_kind: "event",
      target_area: "tourism_events",
      target_owner_id: other.id,
      purchase_entitlement_id: tourismEntitlement,
      addon_capabilities: ["boost", "featured", "urgent"],
    });
    for (const change of [
      "target_post_id=gen_random_uuid()",
      "amount_cents=1",
      "snapshot='{}'::jsonb",
      `owner_id='${owner.id}'`,
    ]) {
      sqlFails(
        `update private.payments set ${change} where id='${addonCheckout.data.payment_id}';`,
        "23514"
      );
    }
    assert.equal((await deleteBillingPost(addonTarget)).status, 200);
    assert.equal(
      historicalPayment(addonCheckout.data.payment_id),
      `${addonTarget}:complete:fulfilled:1:1:0`
    );
    assert.equal(
      sql(
        `select count(*)||':'||bool_and(revoked_at is not null)::text from private.post_addon_windows where post_id='${addonTarget}';`
      ),
      "2:true"
    );
    assert.equal(
      sql(
        `select snapshot::text from private.payments where id='${addonCheckout.data.payment_id}';`
      ),
      quoteBefore
    );
    record("native-billing-deletion-preserves-immutable-quote-invoices-and-revoked-windows");

    for (const order of ["delete_first", "checkout_first"]) {
      const id = billingEventFixture();
      const first = heldAction(
        ownerSql(
          order === "delete_first"
            ? `perform api.delete_post('${id}',1);`
            : `perform api.start_checkout('${boost.id}','${id}');`
        )
      );
      try {
        await first.barrier;
        const name = order === "delete_first" ? "start_checkout" : "delete_post";
        const pending =
          order === "delete_first"
            ? rpc(name, { p_product_id: boost.id, p_target_post: id }, other.token)
            : deleteBillingPost(id);
        await awaitQueuedRpc(name);
        const [result, code] = await Promise.all([pending, first.done]);
        assert.equal(code, 0);
        assert.equal(result.status, order === "delete_first" ? 400 : 200);
        assert.equal(
          sql(`select count(*) from private.payments where target_post_id='${id}';`),
          order === "delete_first" ? "0" : "1"
        );
      } finally {
        first.close();
        await first.done;
      }
    }
    record("native-billing-checkout-versus-delete-both-orders");

    for (const order of ["delete_first", "callback_first"]) {
      const id = billingEventFixture();
      const prepared = await newAddonPayment(id);
      const eventLiteral = JSON.stringify(prepared.event).replaceAll("'", "''");
      const first = heldAction(
        order === "delete_first"
          ? ownerSql(`perform api.delete_post('${id}',1);`)
          : `do $test$ begin perform internal.apply_provider_event('${eventLiteral}'::jsonb); end $test$;`
      );
      try {
        await first.barrier;
        const name = order === "delete_first" ? "apply_provider_event" : "delete_post";
        const pending =
          order === "delete_first"
            ? rpc(name, { p_event: prepared.event }, null, true)
            : deleteBillingPost(id);
        await awaitQueuedRpc(name);
        const [result, code] = await Promise.all([pending, first.done]);
        assert.equal(code, 0);
        assert.equal(result.status, 200);
        const missing = order === "delete_first";
        assert.equal(
          historicalPayment(prepared.payment.payment_id),
          `${id}:complete:${missing ? "needs_reconciliation" : "fulfilled"}:1:${missing ? 0 : 1}:${missing ? 1 : 0}`
        );
        const repeated = await rpc("apply_provider_event", { p_event: prepared.event }, null, true);
        assert.equal(repeated.data.outcome, "duplicate_event");
        assert.equal(
          repeated.data.original_outcome,
          missing ? "complete_unfulfillable_target" : "completed"
        );
        assert.equal(
          await apply({
            ...prepared.event,
            payload_sha256: createHash("sha256").update(randomUUID()).digest("hex"),
          }),
          "already_complete"
        );
        assert.equal(
          sql(
            `select count(*) from private.post_addon_windows where payment_id='${prepared.payment.payment_id}' and revoked_at is null;`
          ),
          "0"
        );
        assert.equal(
          (
            await rpc(
              "reverse_payment",
              {
                p_payment_id: prepared.payment.payment_id,
                p_kind: "refunded",
                p_reason: "Synthetic late settlement refund",
              },
              null,
              true
            )
          ).status,
          200
        );
        assert.equal(
          sql(
            `select status||':'||(select count(*) from private.invoices i where i.payment_id=p.id) from private.payments p where id='${prepared.payment.payment_id}';`
          ),
          "refunded:1"
        );
        assert.equal(
          sql(
            `select fulfillment_status from private.payments where id='${prepared.payment.payment_id}';`
          ),
          "reversed"
        );
        assert.equal(
          await apply({
            ...prepared.event,
            payload_sha256: createHash("sha256").update(randomUUID()).digest("hex"),
          }),
          "reversed_ignored"
        );
        assert.equal(
          sql(
            `select count(*) from private.payments where id='${prepared.payment.payment_id}' and status='complete' and fulfillment_status='needs_reconciliation';`
          ),
          "0"
        );
      } finally {
        first.close();
        await first.done;
      }
    }
    record("native-billing-callback-versus-delete-history-and-late-settlement-reconciliation");

    const duplicateTarget = billingEventFixture();
    const duplicatePrepared = await newAddonPayment(duplicateTarget);
    const duplicateEventLiteral = JSON.stringify(duplicatePrepared.event).replaceAll("'", "''");
    const duplicateBarrier = heldAction(
      `do $test$ begin perform internal.apply_provider_event('${duplicateEventLiteral}'::jsonb); end $test$;`
    );
    try {
      await duplicateBarrier.barrier;
      const pending = rpc("apply_provider_event", { p_event: duplicatePrepared.event }, null, true);
      await awaitQueuedRpc("apply_provider_event");
      const [result, code] = await Promise.all([pending, duplicateBarrier.done]);
      assert.equal(code, 0);
      assert.equal(result.status, 200);
      assert.equal(result.data.outcome, "duplicate_event");
      assert.equal(result.data.original_outcome, "completed");
      assert.equal(
        sql(
          `select count(*) from private.provider_events where payload_sha256='${duplicatePrepared.event.payload_sha256}';`
        ),
        "1"
      );
      assert.equal(
        historicalPayment(duplicatePrepared.payment.payment_id),
        `${duplicateTarget}:complete:fulfilled:1:1:0`
      );
    } finally {
      duplicateBarrier.close();
      await duplicateBarrier.done;
    }
    record("native-billing-concurrent-identical-callback-replays-committed-outcome");

    for (const deadline of ["quote_visibility", "settlement_visibility", "settlement_event"]) {
      nativeStage = `wall-clock ${deadline} expiry during wait`;
      const id = billingEventFixture();
      const prepared = deadline === "quote_visibility" ? null : await newAddonPayment(id);
      if (deadline === "settlement_event")
        sql(
          `update private.event_details set starts_at=date_trunc('second',clock_timestamp())-interval '1 day',ends_at=date_trunc('second',clock_timestamp())+interval '2 seconds' where post_id='${id}';`
        );
      else
        sql(
          `update private.posts set visible_until=clock_timestamp()+interval '2 seconds' where id='${id}';`
        );
      const first = heldAction(
        `do $test$ begin perform internal.lock_evidence_subject('${other.id}'); end $test$;`
      );
      try {
        await first.barrier;
        const name = prepared ? "apply_provider_event" : "start_checkout";
        const pending = prepared
          ? rpc(name, { p_event: prepared.event }, null, true)
          : rpc(name, { p_product_id: boost.id, p_target_post: id }, other.token);
        await awaitQueuedRpc(name);
        const [result, code] = await Promise.all([pending, first.done]);
        assert.equal(code, 0);
        if (prepared) {
          assert.equal(result.status, 200);
          assert.equal(result.data.outcome, "complete_unfulfillable_target");
          assert.equal(
            historicalPayment(prepared.payment.payment_id),
            `${id}:complete:needs_reconciliation:1:0:1`
          );
        } else {
          assert.equal(result.status, 409);
          assert.equal(
            sql(`select count(*) from private.payments where target_post_id='${id}';`),
            "0"
          );
        }
      } finally {
        first.close();
        await first.done;
      }
    }
    const fundingDeadline = sql(
      `select ends_at::text from private.entitlements where payment_id='${checkout.data.payment_id}';`
    );
    const fundingQuote = await rpc(
      "start_checkout",
      { p_product_id: urgent.id, p_target_post: waiting[0] },
      other.token
    );
    assert.equal(fundingQuote.status, 200);
    const fundingRequest = `funding-${randomUUID()}`;
    assert.equal(
      (
        await rpc(
          "attach_provider_request",
          { p_payment_id: fundingQuote.data.payment_id, p_request_id: fundingRequest },
          null,
          true
        )
      ).status,
      200
    );
    const fundingEvent = providerEvent({
      merchant_reference: fundingQuote.data.merchant_reference,
      provider_request_id: fundingRequest,
      provider_transaction_id: `txn-${randomUUID()}`,
      amount_cents: Number(fundingQuote.data.amount_cents),
    });
    sql(
      `update private.entitlements set ends_at=clock_timestamp()+interval '2 seconds' where payment_id='${checkout.data.payment_id}';`
    );
    const fundingBarrier = heldAction(
      `do $test$ begin perform internal.lock_evidence_subject('${other.id}'); end $test$;`
    );
    try {
      await fundingBarrier.barrier;
      const pending = rpc("apply_provider_event", { p_event: fundingEvent }, null, true);
      await awaitQueuedRpc("apply_provider_event");
      const [result, code] = await Promise.all([pending, fundingBarrier.done]);
      assert.equal(code, 0);
      assert.equal(result.data.outcome, "complete_unfulfillable_target");
      assert.equal(
        historicalPayment(fundingQuote.data.payment_id),
        `${waiting[0]}:complete:needs_reconciliation:1:0:1`
      );
    } finally {
      fundingBarrier.close();
      await fundingBarrier.done;
      sql(
        `update private.entitlements set ends_at='${fundingDeadline.replaceAll("'", "''")}'::timestamptz where payment_id='${checkout.data.payment_id}';`
      );
    }
    record("native-billing-wall-clock-target-event-and-funding-expiry-during-owner-wait");

    for (const order of ["delete_first", "refund_first"]) {
      const id = billingEventFixture();
      const prepared = await newAddonPayment(id);
      assert.equal(await apply(prepared.event), "completed");
      const first = heldAction(
        order === "delete_first"
          ? ownerSql(`perform api.delete_post('${id}',1);`)
          : `do $test$ begin perform internal.reverse_payment('${prepared.payment.payment_id}','refunded','Synthetic delete refund race'); end $test$;`
      );
      try {
        await first.barrier;
        const name = order === "delete_first" ? "reverse_payment" : "delete_post";
        const pending =
          order === "delete_first"
            ? rpc(
                name,
                {
                  p_payment_id: prepared.payment.payment_id,
                  p_kind: "refunded",
                  p_reason: "Synthetic delete refund race",
                },
                null,
                true
              )
            : deleteBillingPost(id);
        await awaitQueuedRpc(name);
        const [result, code] = await Promise.all([pending, first.done]);
        assert.equal(code, 0);
        assert.equal(result.status, 200);
        assert.equal(
          historicalPayment(prepared.payment.payment_id),
          `${id}:refunded:reversed:1:1:0`
        );
        assert.equal(
          sql(
            `select revoked_at is not null from private.post_addon_windows where payment_id='${prepared.payment.payment_id}';`
          ),
          "t"
        );
      } finally {
        first.close();
        await first.done;
      }
    }
    record("native-billing-reversal-versus-delete-both-orders-retains-history");
    for (const state of ["paused", "ended"]) {
      const id = billingEventFixture();
      const prepared = await newAddonPayment(id);
      if (state === "paused")
        assert.equal(
          (
            await rpc(
              "set_post_state",
              { p_post_id: id, p_expected_revision: 1, p_action: "pause" },
              other.token
            )
          ).status,
          200
        );
      else
        sql(
          `update private.event_details set starts_at=starts_at-interval '7 days',ends_at=ends_at-interval '7 days' where post_id='${id}';`
        );
      nativeStage = `ineligible ${state} target settlement`;
      assert.equal(
        await apply({
          ...prepared.event,
          payload_sha256: createHash("sha256").update(randomUUID()).digest("hex"),
          amount_cents: 1,
        }),
        "amount_mismatch"
      );
      assert.equal(
        historicalPayment(prepared.payment.payment_id),
        `${id}:pending:unfulfilled:0:0:0`
      );
      assert.equal(await apply(prepared.event), "complete_unfulfillable_target");
      assert.equal(
        historicalPayment(prepared.payment.payment_id),
        `${id}:complete:needs_reconciliation:1:0:1`
      );
    }
    record(
      "native-billing-ineligible-target-settles-without-paid-effect-and-mismatch-still-denied"
    );

    const settlementState = (id) =>
      JSON.parse(
        sql(`select json_build_array(p.status,p.fulfillment_status,
      (select count(*) from private.entitlements e where e.payment_id=p.id and e.status='active'),
      (select count(*) from private.post_addon_windows w where w.payment_id=p.id and w.revoked_at is null),
      (select count(*) from private.invoices i where i.payment_id=p.id),
      (select count(*) from private.outbox_events o where o.subject_id=p.id and o.kind='payment_reconciliation_required'))::text
      from private.payments p where p.id='${uuid(id)}';`)
      );
    for (const product of ["plan", "addon"])
      for (const terminal of ["cancelled", "failed", "expired"]) {
        nativeStage = `${terminal} ${product} late completion`;
        let prepared;
        if (product === "addon") prepared = await newAddonPayment(billingEventFixture());
        else {
          const quote = await rpc("start_checkout", { p_product_id: starter.id }, other.token);
          assert.equal(quote.status, 200);
          const request = `terminal-${randomUUID()}`;
          assert.equal(
            (
              await rpc(
                "attach_provider_request",
                { p_payment_id: quote.data.payment_id, p_request_id: request },
                null,
                true
              )
            ).status,
            200
          );
          prepared = {
            payment: quote.data,
            event: providerEvent({
              merchant_reference: quote.data.merchant_reference,
              provider_request_id: request,
              provider_transaction_id: `txn-${randomUUID()}`,
            }),
          };
        }
        if (terminal === "expired")
          sql(
            `update private.payments set status='expired' where id='${prepared.payment.payment_id}';`
          );
        else
          assert.equal(
            await apply({
              ...prepared.event,
              payload_sha256: createHash("sha256").update(randomUUID()).digest("hex"),
              status: terminal === "cancelled" ? "cancelled" : "error",
              provider_transaction_id: "",
            }),
            "not_paid"
          );
        assert.deepEqual(settlementState(prepared.payment.payment_id), [
          terminal,
          "unfulfilled",
          0,
          0,
          0,
          0,
        ]);
        assert.equal(
          await apply({
            ...prepared.event,
            payload_sha256: createHash("sha256").update(randomUUID()).digest("hex"),
            amount_cents: 1,
          }),
          "amount_mismatch"
        );
        assert.deepEqual(settlementState(prepared.payment.payment_id), [
          terminal,
          "unfulfilled",
          0,
          0,
          0,
          0,
        ]);
        const cancelled = terminal === "cancelled";
        const outcome = cancelled ? "complete_unfulfillable_target" : "completed";
        assert.equal(await apply(prepared.event), outcome);
        const expected = [
          "complete",
          cancelled ? "needs_reconciliation" : "fulfilled",
          !cancelled && product === "plan" ? 1 : 0,
          !cancelled && product === "addon" ? 1 : 0,
          1,
          cancelled ? 1 : 0,
        ];
        assert.deepEqual(settlementState(prepared.payment.payment_id), expected);
        const exactRetry = await rpc(
          "apply_provider_event",
          { p_event: prepared.event },
          null,
          true
        );
        assert.equal(exactRetry.status, 200);
        assert.equal(exactRetry.data.outcome, "duplicate_event");
        assert.equal(exactRetry.data.original_outcome, outcome);
        assert.equal(
          await apply({
            ...prepared.event,
            payload_sha256: createHash("sha256").update(randomUUID()).digest("hex"),
          }),
          "already_complete"
        );
        assert.deepEqual(settlementState(prepared.payment.payment_id), expected);
        assert.equal(
          (
            await rpc(
              "reverse_payment",
              {
                p_payment_id: prepared.payment.payment_id,
                p_kind: "refunded",
                p_reason: "Synthetic terminal checkout reconciliation",
              },
              null,
              true
            )
          ).status,
          200
        );
        assert.deepEqual(settlementState(prepared.payment.payment_id), [
          "refunded",
          "reversed",
          0,
          0,
          1,
          cancelled ? 1 : 0,
        ]);
        assert.equal(
          await apply({
            ...prepared.event,
            payload_sha256: createHash("sha256").update(randomUUID()).digest("hex"),
          }),
          "reversed_ignored"
        );
        assert.deepEqual(settlementState(prepared.payment.payment_id), [
          "refunded",
          "reversed",
          0,
          0,
          1,
          cancelled ? 1 : 0,
        ]);
      }
    record("native-billing-cancelled-plan-and-addon-settle-without-reactivation-retry-and-refund", {
      products: 2,
      terminalStates: 3,
    });

    const memberEmail = `foundation-shared-refund-${randomUUID()}@example.invalid`;
    // Capability is area/source/content-bound, independently of public visibility.
    const expectCapabilityReconciliation = async (prepared) => {
      assert.equal(await apply(prepared.event), "complete_unfulfillable_target");
      assert.deepEqual(settlementState(prepared.payment.payment_id), [
        "complete",
        "needs_reconciliation",
        0,
        0,
        1,
        1,
      ]);
    };
    const capabilityEnd = sql(
      `select ends_at::text from private.entitlements where id='${tourismEntitlement}';`
    );
    for (const loss of ["membership", "expiry"]) {
      nativeStage = `capability ${loss} lost during entitlement wait`;
      sql(
        `insert into private.entitlement_members(entitlement_id,member_id,added_by) values('${tourismEntitlement}','${searchOwner.id}','${other.id}');`
      );
      const prepared = await newAddonPayment(freeAddonTarget, searchOwner.token);
      if (loss === "expiry")
        sql(
          `update private.entitlements set ends_at=clock_timestamp()+interval '2 seconds' where id='${tourismEntitlement}';`
        );
      const barrier = heldAction(
        `do $test$ begin perform id from private.entitlements where id='${tourismEntitlement}' for update; end $test$;`
      );
      try {
        await barrier.barrier;
        const busy = await rpc("apply_provider_event", { p_event: prepared.event }, null, true);
        assert.equal(busy.status, 409);
        assert.deepEqual(settlementState(prepared.payment.payment_id), [
          "pending",
          "unfulfilled",
          0,
          0,
          0,
          0,
        ]);
        if (loss === "membership")
          sql(
            `delete from private.entitlement_members where entitlement_id='${tourismEntitlement}' and member_id='${searchOwner.id}';`
          );
        assert.equal(await barrier.done, 0);
        await expectCapabilityReconciliation(prepared);
        assert.deepEqual(settlementState(prepared.payment.payment_id), [
          "complete",
          "needs_reconciliation",
          0,
          0,
          1,
          1,
        ]);
      } finally {
        barrier.close();
        await barrier.done;
        sql(
          `update private.entitlements set ends_at='${capabilityEnd.replaceAll("'", "''")}'::timestamptz where id='${tourismEntitlement}'; delete from private.entitlement_members where entitlement_id='${tourismEntitlement}' and member_id='${searchOwner.id}';`
        );
      }
    }
    record("native-addon-capability-member-and-expiry-post-wait-reconciliation");
    const capabilityBan = sql(
      `select coalesce(banned_until::text,'') from auth.users where id='${other.id}';`
    );
    for (const loss of ["revoked", "funding_owner"]) {
      nativeStage = `capability lost ${loss}`;
      sql(
        `insert into private.entitlement_members(entitlement_id,member_id,added_by) values('${tourismEntitlement}','${searchOwner.id}','${other.id}');`
      );
      const prepared = await newAddonPayment(freeAddonTarget, searchOwner.token);
      try {
        if (loss === "revoked")
          sql(
            `update private.entitlements set status='revoked',revoked_reason='fixture' where id='${tourismEntitlement}';`
          );
        else
          sql(
            `update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='${other.id}';`
          );
        await expectCapabilityReconciliation(prepared);
      } finally {
        sql(
          `update private.entitlements set status='active',revoked_reason=null where id='${tourismEntitlement}'; update auth.users set banned_until=${capabilityBan ? `'${capabilityBan.replaceAll("'", "''")}'::timestamptz` : "null"} where id='${other.id}'; delete from private.entitlement_members where entitlement_id='${tourismEntitlement}' and member_id='${searchOwner.id}';`
        );
      }
    }
    record("native-addon-capability-revoked-and-funding-owner-restriction-reconciliation");
    const fundCapabilityPlan = async (code, member = other) => {
      const plan = billing.data.plans.find((p) => p.code === code);
      const quote = await rpc("start_checkout", { p_product_id: plan.id }, member.token);
      assert.equal(quote.status, 200);
      const request = `cap-plan-${randomUUID()}`;
      assert.equal(
        (
          await rpc(
            "attach_provider_request",
            { p_payment_id: quote.data.payment_id, p_request_id: request },
            null,
            true
          )
        ).status,
        200
      );
      assert.equal(
        await apply(
          providerEvent({
            merchant_reference: quote.data.merchant_reference,
            provider_request_id: request,
            provider_transaction_id: `cap-plan-txn-${randomUUID()}`,
            amount_cents: Number(quote.data.amount_cents),
          })
        ),
        "completed"
      );
      return {
        payment: quote.data,
        entitlement: uuid(
          sql(`select id from private.entitlements where payment_id='${quote.data.payment_id}';`)
        ),
      };
    };
    const crossArea = await fundCapabilityPlan("multi_10_90d");
    sql(
      `insert into private.entitlement_members(entitlement_id,member_id,added_by) values('${crossArea.entitlement}','${searchOwner.id}','${other.id}');`
    );
    const crossQuote = await newAddonPayment(freeAddonTarget, searchOwner.token);
    assert.equal(
      (
        await rpc(
          "reverse_payment",
          {
            p_payment_id: crossArea.payment.payment_id,
            p_kind: "refunded",
            p_reason: "Synthetic cross-area grant reversal",
          },
          null,
          true
        )
      ).status,
      200
    );
    await expectCapabilityReconciliation(crossQuote);
    sql(
      `delete from private.entitlement_members where entitlement_id='${crossArea.entitlement}' and member_id='${searchOwner.id}';`
    );
    record("native-addon-capability-explicit-cross-area-grant-and-payment-reversal");
    const defaultGrants = [];
    for (const source of ["sponsorship", "contract", "staff_grant"]) {
      const id = randomUUID();
      defaultGrants.push(id);
      const column =
        source === "sponsorship"
          ? "sponsorship_id"
          : source === "contract"
            ? "contract_id"
            : "granted_by";
      const reference = source === "staff_grant" ? other.id : randomUUID();
      sql(
        `insert into private.entitlements(id,owner_id,source,${column},slot_capacity,max_photos,max_videos,starts_at,ends_at) values('${id}','${searchOwner.id}','${source}','${reference}',50,10,1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '30 days');`
      );
    }
    assert.equal(
      (
        await rpc(
          "start_checkout",
          { p_product_id: boost.id, p_target_post: freeAddonTarget },
          searchOwner.token
        )
      ).status,
      403
    );
    sqlFails(
      `update private.entitlements set addon_capabilities=array['boost'] where id='${defaultGrants[0]}';`,
      "23514"
    );
    const explicitGrant = randomUUID();
    sql(
      `insert into private.entitlements(id,owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at,addon_capabilities) values('${explicitGrant}','${searchOwner.id}','staff_grant','${other.id}',50,10,1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '30 days',array['boost']);`
    );
    const explicitPayment = await newAddonPayment(freeAddonTarget, searchOwner.token);
    assert.equal(await apply(explicitPayment.event), "completed");
    assert.deepEqual(settlementState(explicitPayment.payment.payment_id), [
      "complete",
      "fulfilled",
      0,
      1,
      1,
      0,
    ]);
    for (const kind of ["featured", "urgent"])
      assert.equal(
        (
          await rpc(
            "start_checkout",
            {
              p_product_id: billing.data.addons.find((a) => a.kind === kind).id,
              p_target_post: freeAddonTarget,
            },
            searchOwner.token
          )
        ).status,
        403
      );
    const revokedExplicit = await newAddonPayment(freeAddonTarget, searchOwner.token);
    sql(
      `update private.entitlements set status='revoked',revoked_reason='fixture' where id='${explicitGrant}';`
    );
    await expectCapabilityReconciliation(revokedExplicit);
    record("native-addon-capability-grant-defaults-none-explicit-set-and-immutability");
    nativeStage = "capability closed-set array constraints";
    sqlFails(
      `insert into private.plan_versions(plan_code,version,label,price_cents,duration_days,slot_capacity,max_photos,max_videos,addon_capabilities) values('invalid_capability',1,'Fixture',100,30,1,1,0,array['unknown']);`,
      "23514"
    );
    for (const invalid of [
      "array['boost','boost']",
      "array['boost',null]::text[]",
      "array[['boost','urgent']]",
    ])
      sqlFails(
        `insert into private.plan_versions(plan_code,version,label,price_cents,duration_days,slot_capacity,max_photos,max_videos,addon_capabilities) values('invalid_capability',1,'Fixture',100,30,1,1,0,${invalid});`,
        "23514"
      );
    sqlFails(
      `insert into private.entitlements(owner_id,source,slot_capacity,max_photos,max_videos,starts_at,ends_at,addon_capabilities) values('${searchOwner.id}','intro_trial',1,10,1,clock_timestamp(),clock_timestamp()+interval '7 days',array['urgent']);`,
      "23514"
    );
    assert.equal(
      sql(
        `select bool_and(not has_table_privilege(r,'private.post_trial_claims','select,insert,update,delete')) from unnest(array['anon','authenticated','service_role']) r;`
      ),
      "t"
    );
    assert.equal(
      sql(
        `select bool_and(not has_function_privilege(r,'internal.addon_purchase_entitlement(uuid,uuid,text)','execute')) from unnest(array['anon','authenticated','service_role']) r;`
      ),
      "t"
    );
    nativeStage = "trial content and paid replacement capability";
    const capTrial = await rpc(
      "grant_intro_trial",
      {
        p_owner: searchOwner.id,
        p_identity_hmac: randomBytes(32).toString("base64url"),
        p_days: 7,
      },
      null,
      true
    );
    assert.equal(capTrial.data.granted, true);
    const paidTrialOwner = await fundCapabilityPlan("market_30d", searchOwner);
    const trialContent = randomUUID();
    sql(
      `begin; insert into private.posts(id,owner_id,kind,area,category_key,status,published_at,visible_until) values('${trialContent}','${searchOwner.id}','listing','market','electronics','live',statement_timestamp(),statement_timestamp()+interval '7 days'); insert into private.listing_details(post_id) values('${trialContent}'); commit;`
    );
    assert.equal(
      (await rpc("activate_post", { p_post_id: trialContent }, searchOwner.token)).status,
      200
    );
    assert.equal(
      sql(
        `select converted_at is null from private.post_trial_claims where post_id='${trialContent}';`
      ),
      "t"
    );
    assert.equal(
      (
        await rpc(
          "start_checkout",
          { p_product_id: urgent.id, p_target_post: trialContent },
          searchOwner.token
        )
      ).status,
      403
    );
    assert.equal(
      (
        await rpc(
          "set_post_state",
          { p_post_id: trialContent, p_expected_revision: 1, p_action: "pause" },
          searchOwner.token
        )
      ).status,
      200
    );
    sql(
      `begin; update private.posts set status='live' where id='${trialContent}'; insert into private.post_activations(post_id,entitlement_id,owner_id) values('${trialContent}','${defaultGrants[0]}','${searchOwner.id}'); commit;`
    );
    assert.equal(
      sql(
        `select converted_at is null from private.post_trial_claims where post_id='${trialContent}';`
      ),
      "t"
    );
    assert.equal(
      (
        await rpc(
          "start_checkout",
          { p_product_id: urgent.id, p_target_post: trialContent },
          searchOwner.token
        )
      ).status,
      403
    );
    // Synthetic paid replacement; conversion command/UI wiring remains BF-16.
    sql(
      `begin; update private.post_activations set released_at=clock_timestamp(),release_reason='owner' where post_id='${trialContent}' and released_at is null; insert into private.post_activations(post_id,entitlement_id,owner_id) values('${trialContent}','${paidTrialOwner.entitlement}','${searchOwner.id}'); commit;`
    );
    assert.equal(
      sql(
        `select converted_at is not null and converted_by_activation_id is not null from private.post_trial_claims where post_id='${trialContent}';`
      ),
      "t"
    );
    const convertedAddon = await newAddonPayment(trialContent, searchOwner.token, urgent);
    assert.equal(await apply(convertedAddon.event), "completed");
    const trialRevision = Number(
      sql(`select revision from private.posts where id='${trialContent}';`)
    );
    assert.equal(
      (
        await rpc(
          "delete_post",
          { p_post_id: trialContent, p_expected_revision: trialRevision },
          searchOwner.token
        )
      ).status,
      200
    );
    assert.equal(
      sql(`select count(*) from private.post_trial_claims where post_id='${trialContent}';`),
      "0"
    );
    record("native-addon-capability-trial-content-persists-until-paid-replacement", {
      conversion: "synthetic paid activation; command/UI integration remains open",
    });
    const memberPassword = randomBytes(24).toString("base64url");
    const memberCreated = await admin.auth.admin.createUser({
      email: memberEmail,
      password: memberPassword,
      email_confirm: true,
    });
    assert.equal(memberCreated.error, null);
    const refundMember = { id: uuid(memberCreated.data.user.id), member: client(), token: null };
    users.push(refundMember);
    const memberLogin = await refundMember.member.auth.signInWithPassword({
      email: memberEmail,
      password: memberPassword,
    });
    assert.equal(memberLogin.error, null);
    refundMember.token = memberLogin.data.session.access_token;
    const memberClaims = JSON.stringify(
      JSON.parse(Buffer.from(refundMember.token.split(".")[1], "base64url").toString())
    ).replaceAll("'", "''");
    for (const order of [
      "activation_first",
      "refund_first",
      "delete_first",
      "refund_before_delete",
    ]) {
      nativeStage = `shared member ${order} reversal`;
      const funded = await rpc("start_checkout", { p_product_id: starter.id }, other.token);
      assert.equal(funded.status, 200);
      const request = `shared-${randomUUID()}`;
      assert.equal(
        (
          await rpc(
            "attach_provider_request",
            { p_payment_id: funded.data.payment_id, p_request_id: request },
            null,
            true
          )
        ).status,
        200
      );
      assert.equal(
        await apply(
          providerEvent({
            merchant_reference: funded.data.merchant_reference,
            provider_request_id: request,
            provider_transaction_id: `txn-${randomUUID()}`,
          })
        ),
        "completed"
      );
      const entId = uuid(
        sql(`select id from private.entitlements where payment_id='${funded.data.payment_id}';`)
      );
      const id = randomUUID();
      sql(
        `begin; insert into private.entitlement_members(entitlement_id,member_id,added_by) values('${entId}','${refundMember.id}','${other.id}'); insert into private.posts(id,owner_id,kind,area,category_key,status,published_at,visible_until) values('${id}','${refundMember.id}','listing','market','electronics','live',statement_timestamp(),statement_timestamp()+interval '30 days'); insert into private.listing_details(post_id) values('${id}'); commit;`
      );
      if (order === "delete_first" || order === "refund_before_delete")
        assert.equal(
          (await rpc("activate_post", { p_post_id: id }, refundMember.token)).status,
          200
        );
      const first = heldAction(
        order === "activation_first"
          ? `set local role authenticated; do $test$ begin perform set_config('request.jwt.claims','${memberClaims}',true); perform api.activate_post('${id}'); end $test$;`
          : order === "delete_first"
            ? `set local role authenticated; do $test$ begin perform set_config('request.jwt.claims','${memberClaims}',true); perform api.delete_post('${id}',1); end $test$;`
            : `do $test$ begin perform internal.reverse_payment('${funded.data.payment_id}','refunded','Synthetic shared-member refund'); end $test$;`
      );
      const refund = () =>
        rpc(
          "reverse_payment",
          {
            p_payment_id: funded.data.payment_id,
            p_kind: "refunded",
            p_reason: "Synthetic shared-member refund",
          },
          null,
          true
        );
      try {
        await first.barrier;
        if (order === "activation_first" || order === "delete_first") {
          const busy = await refund();
          assert.equal(busy.status, 409);
          assert.equal(
            sql(`select status from private.payments where id='${funded.data.payment_id}';`),
            "complete"
          );
          assert.equal(await first.done, 0);
          const retried = await refund();
          assert.equal(retried.status, 200);
          assert.equal(retried.data.released_activations, order === "activation_first" ? 1 : 0);
        } else if (order === "refund_before_delete") {
          const pending = rpc(
            "delete_post",
            { p_post_id: id, p_expected_revision: 1 },
            refundMember.token
          );
          await awaitQueuedRpc("delete_post");
          const [result, code] = await Promise.all([pending, first.done]);
          assert.equal(code, 0);
          assert.equal(result.status, 409);
          assert.equal(
            (
              await rpc(
                "delete_post",
                { p_post_id: id, p_expected_revision: 2 },
                refundMember.token
              )
            ).status,
            200
          );
        } else {
          const pending = rpc("activate_post", { p_post_id: id }, refundMember.token);
          await awaitQueuedRpc("activate_post");
          const [result, code] = await Promise.all([pending, first.done]);
          assert.equal(code, 0);
          assert.equal(result.status, 402);
        }
        assert.equal(
          sql(
            `select count(*) from private.post_activations where post_id='${id}' and released_at is null;`
          ),
          "0"
        );
        assert.equal(
          sql(`select posts from internal.package_capacity('${refundMember.id}');`),
          "0"
        );
      } finally {
        first.close();
        await first.done;
      }
    }
    record("native-billing-member-activation-versus-refund-both-orders-busy-retry-no-deadlock");
    record("native-billing-member-deletion-versus-refund-both-orders-busy-retry-history");
    const activationTrial = await rpc(
      "grant_intro_trial",
      {
        p_owner: refundMember.id,
        p_identity_hmac: randomBytes(32).toString("base64url"),
        p_days: 7,
      },
      null,
      true
    );
    assert.equal(activationTrial.data.granted, true);
    for (const mode of ["insert", "reuse"])
      for (const loss of ["expiry", "membership"]) {
        nativeStage = `activation ${mode} loses ${loss} during wait`;
        sql(
          `update private.entitlements set status='active',revoked_reason=null where id='${activationTrial.data.entitlement_id}';`
        );
        const id = randomUUID();
        sql(
          `begin; insert into private.posts(id,owner_id,kind,area,category_key,status,published_at,visible_until) values('${id}','${refundMember.id}','listing','market','electronics','live',statement_timestamp(),statement_timestamp()+interval '7 days'); insert into private.listing_details(post_id) values('${id}'); commit;`
        );
        assert.equal(
          (await rpc("activate_post", { p_post_id: id }, refundMember.token)).status,
          200
        );
        assert.equal(
          (
            await rpc(
              "set_post_state",
              { p_post_id: id, p_expected_revision: 1, p_action: "pause" },
              refundMember.token
            )
          ).status,
          200
        );
        sql(
          `update private.entitlements set status='revoked',revoked_reason='fixture' where id='${activationTrial.data.entitlement_id}'; update private.posts set status='live' where id='${id}';`
        );
        const funding = await fundCapabilityPlan("market_30d");
        sql(
          `insert into private.entitlement_members(entitlement_id,member_id,added_by) values('${funding.entitlement}','${refundMember.id}','${other.id}');`
        );
        if (mode === "reuse")
          assert.equal(
            (await rpc("activate_post", { p_post_id: id }, refundMember.token)).status,
            200
          );
        const beforeClaim = sql(
          `select to_jsonb(c)::text from private.post_trial_claims c where post_id='${id}';`
        );
        const beforeActivations = sql(
          `select count(*) from private.post_activations where post_id='${id}';`
        );
        const priorEnd = sql(
          `select ends_at::text from private.entitlements where id='${funding.entitlement}';`
        );
        if (loss === "expiry")
          sql(
            `update private.entitlements set ends_at=clock_timestamp()+interval '2 seconds' where id='${funding.entitlement}';`
          );
        const barrier = heldAction(
          `do $test$ begin perform id from private.entitlements where id='${funding.entitlement}' for update; end $test$;`
        );
        try {
          await barrier.barrier;
          const pending = rpc("activate_post", { p_post_id: id }, refundMember.token);
          await awaitQueuedRpc("activate_post");
          if (loss === "membership")
            sql(
              `delete from private.entitlement_members where entitlement_id='${funding.entitlement}' and member_id='${refundMember.id}';`
            );
          const [result, code] = await Promise.all([pending, barrier.done]);
          assert.equal(code, 0);
          assert.equal(result.status, 402);
          assert.equal(
            sql(`select count(*) from private.post_activations where post_id='${id}';`),
            beforeActivations
          );
          assert.equal(
            sql(`select to_jsonb(c)::text from private.post_trial_claims c where post_id='${id}';`),
            beforeClaim
          );
          if (mode === "insert") {
            // Privileged synthetic corruption cannot manufacture paid conversion proof.
            sql(
              `insert into private.post_activations(post_id,entitlement_id,owner_id,released_at,release_reason) values('${id}','${funding.entitlement}','${refundMember.id}',clock_timestamp(),'owner'); insert into private.post_activations(post_id,entitlement_id,owner_id) values('${id}','${funding.entitlement}','${refundMember.id}');`
            );
            assert.equal(
              sql(
                `select to_jsonb(c)::text from private.post_trial_claims c where post_id='${id}';`
              ),
              beforeClaim
            );
            sql(
              `update private.post_activations set released_at=clock_timestamp(),release_reason='owner' where post_id='${id}' and released_at is null;`
            );
          }
        } finally {
          barrier.close();
          await barrier.done;
          sql(
            `update private.entitlements set ends_at='${priorEnd.replaceAll("'", "''")}'::timestamptz where id='${funding.entitlement}'; delete from private.entitlement_members where entitlement_id='${funding.entitlement}' and member_id='${refundMember.id}';`
          );
        }
        assert.equal(
          (
            await rpc(
              "reverse_payment",
              {
                p_payment_id: funding.payment.payment_id,
                p_kind: "refunded",
                p_reason: "Synthetic activation freshness cleanup",
              },
              null,
              true
            )
          ).status,
          200
        );
      }
    record("native-activation-insert-and-reuse-recheck-expiry-membership-no-conversion");
    record("native-trial-conversion-ignores-ineligible-paid-fixture-inserts");
    const cycleEntitlements = [randomUUID(), randomUUID()].sort();
    const cyclePosts = [randomUUID(), randomUUID(), randomUUID()];
    const cycleOwners = [searchOwner.id, other.id, refundMember.id];
    for (let index = 0; index < 2; index++) {
      sql(
        `insert into private.entitlements(id,owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at,addon_capabilities) values('${cycleEntitlements[index]}','${other.id}','staff_grant','${other.id}',1,10,1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '${index === 0 ? 30 : 7} days',array['urgent']);`
      );
      for (const member of [searchOwner, refundMember])
        sql(
          `insert into private.entitlement_members(entitlement_id,member_id,added_by) values('${cycleEntitlements[index]}','${member.id}','${other.id}');`
        );
    }
    for (let index = 0; index < 3; index++)
      sql(
        `begin; insert into private.posts(id,owner_id,kind,area,category_key,status,published_at,visible_until) values('${cyclePosts[index]}','${cycleOwners[index]}','listing','market','electronics','live',statement_timestamp(),statement_timestamp()+interval '7 days'); insert into private.listing_details(post_id) values('${cyclePosts[index]}'); commit;`
      );
    assert.equal(
      (await rpc("activate_post", { p_post_id: cyclePosts[0] }, searchOwner.token)).status,
      200
    );
    assert.equal(
      sql(
        `select converted_at is null from private.post_trial_claims where post_id='${cyclePosts[0]}';`
      ),
      "t"
    );
    assert.equal(
      (await rpc("activate_post", { p_post_id: cyclePosts[1] }, other.token)).data.entitlement_id,
      cycleEntitlements[1]
    );
    const cycleBarrier = controlledSql(
      `begin; select id from private.entitlements where id='${cycleEntitlements[1]}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); set local role authenticated; do $test$ begin perform set_config('request.jwt.claims','${memberClaims}',true); perform api.activate_post('${cyclePosts[2]}'); end $test$; commit;`
    );
    try {
      await cycleBarrier.barrier;
      const busy = await rpc(
        "start_checkout",
        { p_product_id: urgent.id, p_target_post: cyclePosts[0] },
        searchOwner.token
      );
      assert.equal(busy.status, 409);
      assert.equal(
        sql(`select count(*) from private.payments where target_post_id='${cyclePosts[0]}';`),
        "0"
      );
      assert.equal(await cycleBarrier.done, 0);
      assert.equal(
        sql(
          `select entitlement_id from private.post_activations where post_id='${cyclePosts[2]}' and released_at is null;`
        ),
        cycleEntitlements[0]
      );
      assert.equal(
        (
          await rpc(
            "start_checkout",
            { p_product_id: urgent.id, p_target_post: cyclePosts[0] },
            searchOwner.token
          )
        ).status,
        403
      );
    } finally {
      cycleBarrier.close();
      await cycleBarrier.done;
      sql(
        `update private.entitlements set status='revoked',revoked_reason='fixture' where id in('${cycleEntitlements[0]}','${cycleEntitlements[1]}');`
      );
    }
    record("native-addon-and-activation-opposing-entitlement-order-retries-no-deadlock");
    // Restore free-event capacity for the later fair-use publication checks.
    sql(
      `delete from private.posts where id in (${billingEvents.map((id) => `'${id}'`).join(",")});`
    );
    assert.equal(
      (
        await rpc(
          "reverse_payment",
          {
            p_payment_id: tourismFunding.data.payment_id,
            p_kind: "refunded",
            p_reason: "Synthetic capability fixture cleanup",
          },
          null,
          true
        )
      ).status,
      200
    );

    const reversal = await rpc(
      "reverse_payment",
      {
        p_payment_id: checkout.data.payment_id,
        p_kind: "refunded",
        p_reason: "Synthetic refund check",
      },
      null,
      true
    );
    assert.equal(reversal.status, 200);
    assert.equal(reversal.data.released_activations, 1);
    assert.equal((await rpc("activate_post", { p_post_id: waiting[2] }, other.token)).status, 402);
    assert.equal(await apply(providerEvent()), "reversed_ignored");
    record("native-billing-reversal-revokes-capacity");

    const identity = randomBytes(32).toString("base64url");
    const trial = await rpc(
      "grant_intro_trial",
      { p_owner: other.id, p_identity_hmac: identity, p_days: 7 },
      null,
      true
    );
    assert.equal(trial.data.granted, true);
    assert.equal(
      (
        await rpc(
          "grant_intro_trial",
          { p_owner: other.id, p_identity_hmac: identity, p_days: 30 },
          null,
          true
        )
      ).data.reason,
      "identity_already_used"
    );
    assert.equal((await rpc("activate_post", { p_post_id: waiting[2] }, other.token)).status, 200);
    sql(
      `update private.entitlements set starts_at=statement_timestamp()-interval '8 days', ends_at=statement_timestamp()-interval '1 second' where id='${uuid(trial.data.entitlement_id)}';`
    );
    assert.equal((await rpc("my_posting_capacity", {}, other.token)).data.capacity, 0);
    assert.equal(
      (await rpc("activate_post", { p_post_id: activated[0] }, other.token)).status,
      402
    );
    record("native-billing-trial-identity-and-read-time-expiry");

    sqlFails(
      `update private.plan_versions set price_cents=1 where plan_code='market_30d';`,
      "23514"
    );
    sqlFails(`delete from private.addon_versions where kind='urgent';`, "23514");
    assert.equal(
      sql(
        "select bool_and(not has_table_privilege(r,t,'select,insert,update,delete,truncate,references,trigger')) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private.plan_versions','private.addon_versions','private.payments','private.provider_events','private.entitlements','private.entitlement_members','private.trial_identities','private.post_activations','private.post_addon_windows','private.invoices','private.outbox_events']) t;"
      ),
      "t"
    );
    record("native-billing-immutable-catalogue-and-private-tables");
    // BF-08: live staff AAL2 + recent TOTP, claims/self-review, durable evidence
    // access audit, upload journal, two-person version binding, legal holds.
    const totp = nativeTotp;
    const staff = {};
    for (const [name, role] of [
      ["moderator", "moderator"],
      ["governorB", "governor"],
      ["governorC", "governor"],
      ["admin", "admin"],
    ]) {
      const email = `foundation-staff-${name}-${randomUUID()}@example.invalid`;
      const password = randomBytes(24).toString("base64url");
      nativeStage = "staff synthetic Auth creation";
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      assert.equal(created.error, null, "Local synthetic staff creation failed");
      const tracked = { id: uuid(created.data.user.id), member: client(), token: null, aal1: null };
      users.push(tracked);
      nativeStage = "staff password login";
      const login = await tracked.member.auth.signInWithPassword({ email, password });
      assert.equal(login.error, null);
      tracked.aal1 = login.data.session.access_token;
      nativeStage = "staff TOTP enrollment";
      const enrolled = await tracked.member.auth.mfa.enroll({ factorType: "totp" });
      assert.equal(enrolled.error, null, "Local TOTP enrolment failed");
      nativeStage = "staff TOTP challenge";
      const challenged = await tracked.member.auth.mfa.challenge({ factorId: enrolled.data.id });
      assert.equal(challenged.error, null, "Local TOTP challenge failed");
      nativeStage = "staff TOTP verification";
      const verified = await tracked.member.auth.mfa.verify({
        factorId: enrolled.data.id,
        challengeId: challenged.data.id,
        code: totp(enrolled.data.totp.secret),
      });
      assert.equal(verified.error, null, "Local TOTP verification failed");
      tracked.token = (await tracked.member.auth.getSession()).data.session.access_token;
      sql(`insert into private.staff_roles(user_id,role) values('${tracked.id}','${role}');`);
      staff[name] = tracked;
    }
    nativeStage = "staff initial evidence cases";
    const caseId = randomUUID();
    const secondCase = randomUUID();
    const moderatorCase = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind) values('${caseId}','${other.id}','kyc'),('${secondCase}','${other.id}','business'),('${moderatorCase}','${staff.moderator.id}','kyc');`
    );
    const intent = await rpc(
      "begin_evidence_upload",
      { p_case_id: caseId, p_purpose: "id_front" },
      other.token
    );
    assert.equal(intent.status, 200);
    assert.equal(
      (
        await rpc(
          "begin_evidence_upload",
          { p_case_id: moderatorCase, p_purpose: "selfie" },
          other.token
        )
      ).status,
      400
    );
    const artifact = intent.data.artifact_id;
    const advance = (state, sha = null) =>
      rpc(
        "advance_evidence_artifact",
        { p_artifact_id: artifact, p_state: state, p_sha256: sha, p_size: sha ? 1234 : null },
        null,
        true
      );
    assert.equal((await advance("clean")).status, 400); // intent cannot skip scanning
    assert.equal(
      (await advance("uploaded", createHash("sha256").update("bf08").digest("hex"))).status,
      200
    );
    assert.equal(
      (await advance("uploaded", createHash("sha256").update("bf08").digest("hex"))).status,
      200
    );
    assert.equal(sql(`select version from private.evidence_cases where id='${caseId}';`), "3");
    assert.equal(
      (await advance("uploaded", createHash("sha256").update("conflicting-bf08").digest("hex")))
        .status,
      409
    );
    assert.equal(
      (
        await rpc(
          "advance_evidence_artifact",
          { p_artifact_id: artifact, p_state: "uploaded", p_size: 1235 },
          null,
          true
        )
      ).status,
      409
    );
    assert.equal(sql(`select version from private.evidence_cases where id='${caseId}';`), "3");
    record("native-evidence-server-metadata-conflict-checked-idempotence");
    assert.equal((await advance("clean")).status, 200);
    assert.equal((await advance("uploaded")).status, 400);
    assert.equal(
      sql(`select retain_until is null from private.evidence_artifacts where id='${artifact}';`),
      "t"
    );
    assert.equal(
      (
        await rpc(
          "advance_evidence_artifact",
          { p_artifact_id: artifact, p_state: "deleted" },
          other.token
        )
      ).status,
      403
    );
    record("native-trust-upload-journal-transitions");

    const evidenceClaims = new Map();
    const acquireEvidenceClaim = async (who, id) => {
      const result = await rpc("claim_evidence_case", { p_case_id: id }, who.token);
      if (result.status === 200) evidenceClaims.set(id, result.data);
      return result;
    };
    const evidenceMetadata = (
      who,
      id = caseId,
      token = who.token,
      lease = evidenceClaims.get(id)
    ) =>
      rpc(
        "staff_evidence_metadata",
        {
          p_case_id: id,
          p_claim_generation: lease ? lease.claim_generation : "1",
          p_claim_nonce: lease ? lease.claim_nonce : randomUUID(),
          p_purpose: "routine_review",
        },
        token
      );
    const renewEvidenceClaim = (who, id, lease = evidenceClaims.get(id)) =>
      rpc(
        "renew_evidence_claim",
        {
          p_case_id: id,
          p_claim_generation: lease ? lease.claim_generation : "1",
          p_claim_nonce: lease ? lease.claim_nonce : randomUUID(),
        },
        who.token
      );
    assert.equal(
      (await evidenceMetadata(staff.moderator, caseId, staff.moderator.aal1)).status,
      403
    );
    assert.equal(
      (await rpc("claim_evidence_case", { p_case_id: caseId }, staff.moderator.aal1)).status,
      403
    );
    assert.equal((await evidenceMetadata(staff.moderator)).status, 403); // no claim yet
    assert.equal((await evidenceMetadata(staff.admin)).status, 403); // admin lacks evidence:view
    assert.equal((await acquireEvidenceClaim(staff.moderator, caseId)).status, 200);
    assert.equal(
      (await rpc("claim_evidence_case", { p_case_id: caseId }, staff.governorB.token)).status,
      409
    );
    assert.equal(
      (await rpc("claim_evidence_case", { p_case_id: moderatorCase }, staff.moderator.token))
        .status,
      403
    );
    const viewed = await evidenceMetadata(staff.moderator);
    assert.equal(viewed.status, 200);
    assert.equal(viewed.data.artifacts.length, 1);
    assert.equal(JSON.stringify(viewed.data).includes("evidence/"), false);
    assert.equal(JSON.stringify(viewed.data).includes("sha256"), false);
    assert.equal(
      sql(
        `select count(*)||':'||bool_and(artifact_ids='{${artifact}}') from private.evidence_access_log where case_id='${caseId}' and staff_id='${staff.moderator.id}';`
      ),
      "1:true"
    );
    sqlFails(
      `update private.evidence_access_log set purpose='x' where case_id='${caseId}';`,
      "23514"
    );
    sqlFails(`delete from private.evidence_access_log where case_id='${caseId}';`, "23514");
    record("native-trust-staff-aal2-claim-and-durable-access-audit");
    const firstClaim = evidenceClaims.get(caseId);
    assert.equal(firstClaim.claim_generation, "1");
    assert.equal((await acquireEvidenceClaim(staff.moderator, caseId)).status, 200);
    const rotatedClaim = evidenceClaims.get(caseId);
    assert.equal(rotatedClaim.claim_generation, "2");
    assert.notEqual(rotatedClaim.claim_nonce, firstClaim.claim_nonce);
    assert.equal(rotatedClaim.version, firstClaim.version);
    const beforeStaleLease = sql(
      `select row_to_json(c)::text from private.evidence_cases c where id='${caseId}';`
    );
    const auditBeforeStale = sql(
      `select count(*) from private.evidence_access_log where case_id='${caseId}';`
    );
    assert.equal(
      (await evidenceMetadata(staff.moderator, caseId, staff.moderator.token, firstClaim)).status,
      403
    );
    assert.equal((await renewEvidenceClaim(staff.moderator, caseId, firstClaim)).status, 403);
    for (const generation of [null, "0", "01", "-1", "1.0", "1e1", "92233720368547758070"]) {
      assert.equal(
        (
          await evidenceMetadata(staff.moderator, caseId, staff.moderator.token, {
            ...rotatedClaim,
            claim_generation: generation,
          })
        ).status,
        400
      );
    }
    assert.equal(
      (
        await evidenceMetadata(staff.moderator, caseId, staff.moderator.token, {
          ...rotatedClaim,
          claim_nonce: null,
        })
      ).status,
      400
    );
    assert.equal(
      (
        await evidenceMetadata(staff.moderator, caseId, staff.moderator.token, {
          ...rotatedClaim,
          claim_nonce: randomUUID(),
        })
      ).status,
      403
    );
    assert.equal(
      sql(`select row_to_json(c)::text from private.evidence_cases c where id='${caseId}';`),
      beforeStaleLease
    );
    assert.equal(
      sql(`select count(*) from private.evidence_access_log where case_id='${caseId}';`),
      auditBeforeStale
    );
    const unfenced = await rpc(
      "staff_evidence_metadata",
      { p_case_id: caseId, p_purpose: "routine_review" },
      staff.moderator.token
    );
    assert.equal(unfenced.status, 404);
    assert.equal(
      sql(
        "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('api','internal') and p.proname='staff_evidence_metadata' and p.pronargs=2;"
      ),
      "0"
    );
    const renewed = await renewEvidenceClaim(staff.moderator, caseId);
    assert.equal(renewed.status, 200);
    assert.equal(renewed.data.claim_generation, rotatedClaim.claim_generation);
    assert.equal(renewed.data.claim_nonce, rotatedClaim.claim_nonce);
    assert.equal(renewed.data.version, rotatedClaim.version);
    record("native-evidence-claim-reacquisition-stale-fence-renewal-and-no-unfenced-overload");
    const claimAuditCount = sql(
      `select count(*) from private.evidence_access_log where case_id='${caseId}';`
    );
    const claimExpiryBarrier = controlledSql(
      `begin; select internal.lock_evidence_subject('${other.id}'); select id from private.evidence_cases where id='${caseId}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update private.evidence_cases set claim_expires_at=clock_timestamp()-interval '0.5 seconds' where id='${caseId}'; commit;`
    );
    try {
      await claimExpiryBarrier.barrier;
      const [lateRead, code] = await Promise.all([
        evidenceMetadata(staff.moderator),
        claimExpiryBarrier.done,
      ]);
      assert.equal(code, 0);
      assert.equal(lateRead.status, 403);
    } finally {
      claimExpiryBarrier.close();
    }
    assert.equal(
      sql(`select count(*) from private.evidence_access_log where case_id='${caseId}';`),
      claimAuditCount
    );
    const expiredLeaseRow = sql(
      `select row_to_json(c)::text from private.evidence_cases c where id='${caseId}';`
    );
    assert.equal((await renewEvidenceClaim(staff.moderator, caseId)).status, 403);
    assert.equal(
      sql(`select row_to_json(c)::text from private.evidence_cases c where id='${caseId}';`),
      expiredLeaseRow
    );
    assert.equal((await acquireEvidenceClaim(staff.moderator, caseId)).status, 200);
    assert.equal(
      sql(
        `select claim_expires_at>clock_timestamp()+interval '29 minutes' from private.evidence_cases where id='${caseId}';`
      ),
      "t"
    );
    record("native-evidence-claim-expiry-during-wait-denies-read-without-audit");
    assert.equal(evidenceClaims.get(caseId).claim_generation, "3");

    const claimRaceCase = randomUUID(),
      crossClaimCase = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind) values('${claimRaceCase}','${other.id}','kyc'),('${crossClaimCase}','${other.id}','business');`
    );
    const raceInitial = await acquireEvidenceClaim(staff.moderator, claimRaceCase);
    assert.equal(raceInitial.status, 200);
    const crossInitial = await acquireEvidenceClaim(staff.moderator, crossClaimCase);
    assert.equal(crossInitial.status, 200);
    const crossAuditBefore = sql(
      `select count(*) from private.evidence_access_log where case_id='${crossClaimCase}';`
    );
    assert.equal(
      (
        await evidenceMetadata(
          staff.moderator,
          crossClaimCase,
          staff.moderator.token,
          raceInitial.data
        )
      ).status,
      403
    );
    assert.equal(
      (await renewEvidenceClaim(staff.moderator, crossClaimCase, raceInitial.data)).status,
      403
    );
    assert.equal(
      sql(`select count(*) from private.evidence_access_log where case_id='${crossClaimCase}';`),
      crossAuditBefore
    );
    sql(
      `update private.evidence_cases set claim_expires_at=clock_timestamp()-interval '1 second' where id='${claimRaceCase}';`
    );
    const acquisitions = await Promise.all([
      acquireEvidenceClaim(staff.governorB, claimRaceCase),
      acquireEvidenceClaim(staff.governorC, claimRaceCase),
    ]);
    assert.deepEqual(acquisitions.map((r) => r.status).sort(), [200, 409]);
    const raceWinner = acquisitions[0].status === 200 ? staff.governorB : staff.governorC;
    assert.equal(evidenceClaims.get(claimRaceCase).claim_generation, "2");
    assert.equal(
      (
        await evidenceMetadata(
          staff.moderator,
          claimRaceCase,
          staff.moderator.token,
          raceInitial.data
        )
      ).status,
      403
    );
    assert.equal((await evidenceMetadata(raceWinner, claimRaceCase)).status, 200);
    assert.equal(
      sql(`select version from private.evidence_cases where id='${claimRaceCase}';`),
      "1"
    );
    record("native-evidence-claim-cross-case-denial-and-concurrent-expired-takeover");

    const waitingOldClaim = evidenceClaims.get(crossClaimCase);
    const auditBeforeRotation = sql(
      `select count(*) from private.evidence_access_log where case_id='${crossClaimCase}';`
    );
    const rotationBarrier = controlledSql(
      `begin; select internal.lock_evidence_subject('${other.id}'); select id from private.evidence_cases where id='${crossClaimCase}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update private.evidence_cases set claim_generation=claim_generation+1,claim_nonce=gen_random_uuid(),claim_expires_at=clock_timestamp()+interval '30 minutes' where id='${crossClaimCase}'; commit;`
    );
    try {
      await rotationBarrier.barrier;
      const [lateRead, code] = await Promise.all([
        evidenceMetadata(staff.moderator, crossClaimCase, staff.moderator.token, waitingOldClaim),
        rotationBarrier.done,
      ]);
      assert.equal(code, 0);
      assert.equal(lateRead.status, 403);
    } finally {
      rotationBarrier.close();
    }
    assert.equal(
      sql(`select count(*) from private.evidence_access_log where case_id='${crossClaimCase}';`),
      auditBeforeRotation
    );
    const largeGenerationCase = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind,claim_generation) values('${largeGenerationCase}','${other.id}','kyc',9007199254740993);`
    );
    const largeClaim = await acquireEvidenceClaim(staff.moderator, largeGenerationCase);
    assert.equal(largeClaim.status, 200);
    assert.equal(largeClaim.data.claim_generation, "9007199254740994");
    assert.equal((await renewEvidenceClaim(staff.moderator, largeGenerationCase)).status, 200);
    const exhaustedGenerationCase = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind,claim_generation) values('${exhaustedGenerationCase}','${other.id}','kyc',9223372036854775807);`
    );
    const exhaustedBefore = sql(
      `select row_to_json(c)::text from private.evidence_cases c where id='${exhaustedGenerationCase}';`
    );
    assert.equal(
      (await acquireEvidenceClaim(staff.moderator, exhaustedGenerationCase)).status,
      409
    );
    assert.equal(
      sql(
        `select row_to_json(c)::text from private.evidence_cases c where id='${exhaustedGenerationCase}';`
      ),
      exhaustedBefore
    );
    assert.equal(
      sql(
        "select count(*) from information_schema.columns where table_schema='private' and table_name='evidence_access_log' and column_name like '%nonce%';"
      ),
      "0"
    );
    record("native-evidence-post-wait-claim-rotation-denial-and-lossless-generation");
    const fencedAuditBefore = sql(
      `select count(*) from private.evidence_access_log where case_id='${largeGenerationCase}';`
    );
    const metadataRoleBarrier = controlledSql(
      `begin; select internal.lock_evidence_subject('${other.id}'); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update private.staff_roles set revoked_at=clock_timestamp(),revoked_by='${staff.admin.id}' where user_id='${staff.moderator.id}'; commit;`
    );
    try {
      await metadataRoleBarrier.barrier;
      const [lateMetadata, code] = await Promise.all([
        evidenceMetadata(staff.moderator, largeGenerationCase),
        metadataRoleBarrier.done,
      ]);
      assert.equal(code, 0);
      assert.equal(lateMetadata.status, 403);
    } finally {
      metadataRoleBarrier.close();
      sql(
        `update private.staff_roles set revoked_at=null,revoked_by=null where user_id='${staff.moderator.id}';`
      );
    }
    const metadataSession = uuid(
      JSON.parse(Buffer.from(staff.moderator.token.split(".")[1], "base64url").toString())
        .session_id
    );
    const previousMetadataExpiry = sql(
      `select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='${metadataSession}';`
    );
    const metadataSessionBarrier = controlledSql(
      `begin; select internal.lock_evidence_subject('${other.id}'); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update auth.sessions set not_after=clock_timestamp()-interval '0.5 seconds' where id='${metadataSession}'; commit;`
    );
    try {
      await metadataSessionBarrier.barrier;
      const [lateMetadata, code] = await Promise.all([
        evidenceMetadata(staff.moderator, largeGenerationCase),
        metadataSessionBarrier.done,
      ]);
      assert.equal(code, 0);
      assert.equal(lateMetadata.status, 403);
    } finally {
      metadataSessionBarrier.close();
      sql(
        `update auth.sessions set not_after=${previousMetadataExpiry} where id='${metadataSession}';`
      );
    }
    assert.equal(
      sql(
        `select count(*) from private.evidence_access_log where case_id='${largeGenerationCase}';`
      ),
      fencedAuditBefore
    );
    record("native-evidence-fenced-metadata-role-session-revocation-during-wait-no-audit");
    const reviewedVersion = Number(
      sql(`select version from private.evidence_cases where id='${caseId}';`)
    );
    assert.equal(reviewedVersion, 4); // intent, uploaded and clean each advance the parent.

    assert.equal(
      (
        await rpc(
          "propose_decision",
          { p_case_id: caseId, p_expected_version: 1, p_action: "approve_override", p_payload: {} },
          staff.moderator.token
        )
      ).status,
      403
    );
    assert.equal(
      (
        await rpc(
          "propose_decision",
          { p_case_id: caseId, p_expected_version: 9, p_action: "approve_override", p_payload: {} },
          staff.governorB.token
        )
      ).status,
      409
    );
    const proposal = await rpc(
      "propose_decision",
      {
        p_case_id: caseId,
        p_expected_version: reviewedVersion,
        p_action: "approve_override",
        p_payload: { note: "synthetic" },
      },
      staff.governorB.token
    );
    assert.equal(proposal.status, 200);
    assert.equal(
      sql(
        `select jsonb_array_length(reviewed_snapshot) from private.decisions where id='${uuid(proposal.data.decision_id)}';`
      ),
      "1"
    );
    sqlFails(
      `update private.decisions set reviewed_snapshot='[]' where id='${uuid(proposal.data.decision_id)}';`,
      "23514"
    );
    sqlFails(
      `update private.evidence_cases set subject_id='${owner.id}' where id='${caseId}';`,
      "23514"
    );
    sqlFails(
      `update private.decisions set payload='{"note":"changed"}' where id='${uuid(proposal.data.decision_id)}';`,
      "23514"
    );
    assert.equal(
      (
        await rpc(
          "approve_decision",
          { p_decision_id: proposal.data.decision_id },
          staff.governorB.token
        )
      ).status,
      403
    );
    assert.equal(
      (
        await rpc(
          "approve_decision",
          { p_decision_id: proposal.data.decision_id },
          staff.governorC.token
        )
      ).status,
      200
    );
    assert.equal(
      sql(
        `select claimed_by is null and claim_nonce is null and claim_expires_at is null and claim_generation=3 from private.evidence_cases where id='${caseId}';`
      ),
      "t"
    );
    assert.equal(
      (
        await rpc(
          "approve_decision",
          { p_decision_id: proposal.data.decision_id },
          staff.admin.token
        )
      ).status,
      400
    );
    const stale = await rpc(
      "propose_decision",
      { p_case_id: secondCase, p_expected_version: 1, p_action: "reject", p_payload: {} },
      staff.governorB.token
    );
    sql(`update private.evidence_cases set version=version+1 where id='${secondCase}';`);
    assert.equal(
      (
        await rpc(
          "approve_decision",
          { p_decision_id: stale.data.decision_id },
          staff.governorC.token
        )
      ).status,
      409
    );
    record("native-trust-two-person-version-bound-decisions");

    const changingCase = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind) values('${changingCase}','${other.id}','kyc');`
    );
    const proposeVersion = (id, version) =>
      rpc(
        "propose_decision",
        { p_case_id: id, p_expected_version: version, p_action: "approve_override", p_payload: {} },
        staff.governorB.token
      );
    const approveId = (id) => rpc("approve_decision", { p_decision_id: id }, staff.governorC.token);
    const withdrawDecision = (id, version, reason, token = staff.governorB.token) =>
      rpc(
        "withdraw_decision",
        { p_decision_id: id, p_expected_version: version, p_reason: reason },
        token
      );
    const recoveryCase = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind) values('${recoveryCase}','${other.id}','kyc');`
    );
    const recoveryProposal = await proposeVersion(recoveryCase, 1);
    assert.equal(recoveryProposal.status, 200);
    const recoveryId = uuid(recoveryProposal.data.decision_id);
    const beforeWithdrawal = sql(
      `select row_to_json(d)::text from private.decisions d where id='${recoveryId}';`
    );
    for (const token of [other.token, staff.moderator.token, staff.governorB.aal1, null])
      assert.ok(
        [401, 403].includes(
          (await withdrawDecision(recoveryId, 1, "Synthetic withdrawal", token)).status
        )
      );
    assert.equal(
      (
        await rpc(
          "withdraw_decision",
          { p_decision_id: recoveryId, p_expected_version: 1, p_reason: "Synthetic withdrawal" },
          null,
          true
        )
      ).status,
      403
    );
    for (const version of [null, 0, -1])
      assert.equal(
        (await withdrawDecision(recoveryId, version, "Synthetic withdrawal")).status,
        400
      );
    for (const reason of [null, "tiny", "\t\n", "x".repeat(501), "Hidden\u202ereason"])
      assert.equal((await withdrawDecision(recoveryId, 1, reason)).status, 400);
    assert.equal((await withdrawDecision(recoveryId, 2, "Synthetic withdrawal")).status, 409);
    assert.equal(
      (await withdrawDecision(recoveryId, 1, "Synthetic withdrawal", staff.governorC.token)).status,
      403
    );
    assert.equal(
      sql(`select row_to_json(d)::text from private.decisions d where id='${recoveryId}';`),
      beforeWithdrawal
    );
    sqlFails(
      `update private.decisions set id='${randomUUID()}' where id='${recoveryId}';`,
      "23514"
    );
    sqlFails(
      `update private.decisions set withdrawn_by='${staff.governorB.id}' where id='${recoveryId}';`,
      "23514"
    );
    const authorWithdraw = await withdrawDecision(recoveryId, 1, "  Synthetic withdrawal  ");
    assert.equal(authorWithdraw.status, 200);
    assert.deepEqual(authorWithdraw.data, { decision_id: recoveryId, status: "withdrawn" });
    assert.equal(
      sql(
        `select withdrawn_by='${staff.governorB.id}' and withdrawn_case_version=1 and withdrawal_reason='Synthetic withdrawal' and withdrawn_at is not null and approved_by is null and approved_at is null from private.decisions where id='${recoveryId}';`
      ),
      "t"
    );
    const finalizedWithdrawal = sql(
      `select row_to_json(d)::text from private.decisions d where id='${recoveryId}';`
    );
    sql(`update private.evidence_cases set version=version+1 where id='${recoveryCase}';`);
    assert.equal((await withdrawDecision(recoveryId, 1, "Synthetic withdrawal")).status, 200); // Retry remains valid after newer case material.
    assert.equal((await withdrawDecision(recoveryId, 2, "Different withdrawal")).status, 409);
    assert.equal(
      (await withdrawDecision(recoveryId, 2, "Synthetic withdrawal", staff.governorC.token)).status,
      409
    );
    assert.equal(
      sql(`select row_to_json(d)::text from private.decisions d where id='${recoveryId}';`),
      finalizedWithdrawal
    );
    sqlFails(
      `update private.decisions set withdrawal_reason='Changed audit' where id='${recoveryId}';`,
      "23514"
    );
    const reproposed = await proposeVersion(recoveryCase, 2);
    assert.equal(reproposed.status, 200);
    assert.notEqual(reproposed.data.decision_id, recoveryId);
    assert.equal(
      (
        await rpc(
          "approve_decision",
          { p_decision_id: reproposed.data.decision_id },
          staff.governorB.token
        )
      ).status,
      403
    );
    assert.equal((await approveId(reproposed.data.decision_id)).status, 200);
    assert.equal(
      (await withdrawDecision(reproposed.data.decision_id, 3, "Synthetic approved withdrawal"))
        .status,
      400
    );
    assert.equal(
      sql(
        `select count(*) from private.decisions where case_id='${recoveryCase}' and status='withdrawn';`
      ),
      "1"
    );
    record("native-decision-author-withdrawal-audit-idempotent-retry-and-reproposal");

    const obsoleteCase = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind) values('${obsoleteCase}','${other.id}','kyc');`
    );
    const obsoleteProposal = await proposeVersion(obsoleteCase, 1);
    assert.equal(obsoleteProposal.status, 200);
    assert.equal(
      (
        await rpc(
          "begin_evidence_upload",
          { p_case_id: obsoleteCase, p_purpose: "selfie" },
          other.token
        )
      ).status,
      200
    );
    assert.equal(
      (
        await withdrawDecision(
          obsoleteProposal.data.decision_id,
          1,
          "Obsolete material",
          staff.governorC.token
        )
      ).status,
      409
    );
    assert.equal(
      (
        await withdrawDecision(
          obsoleteProposal.data.decision_id,
          2,
          "Obsolete material",
          staff.governorC.token
        )
      ).status,
      200
    );
    const freshObsoleteProposal = await proposeVersion(obsoleteCase, 2);
    assert.equal(freshObsoleteProposal.status, 200);
    assert.equal(
      sql(
        `select jsonb_array_length(reviewed_snapshot) from private.decisions where id='${uuid(freshObsoleteProposal.data.decision_id)}';`
      ),
      "1"
    );
    const exhaustedCase = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind) values('${exhaustedCase}','${other.id}','business');`
    );
    const exhaustedProposal = await proposeVersion(exhaustedCase, 1);
    assert.equal(exhaustedProposal.status, 200);
    sql(
      `update private.evidence_cases set status='closed',version=2147483647 where id='${exhaustedCase}';`
    );
    assert.equal(
      (
        await withdrawDecision(
          exhaustedProposal.data.decision_id,
          2147483647,
          "Closed exhausted case",
          staff.governorC.token
        )
      ).status,
      200
    );
    record("native-decision-obsolete-other-reviewer-and-closed-max-version-recovery");

    for (const withdrawFirst of [false, true]) {
      const concurrentCase = randomUUID();
      sql(
        `insert into private.evidence_cases(id,subject_id,kind) values('${concurrentCase}','${other.id}','kyc');`
      );
      const concurrentProposal = await proposeVersion(concurrentCase, 1);
      assert.equal(concurrentProposal.status, 200);
      const concurrentId = uuid(concurrentProposal.data.decision_id);
      const operationBarrier = controlledSql(
        `begin; select internal.lock_evidence_subject('${other.id}'); select id from private.evidence_cases where id='${concurrentCase}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); commit;`
      );
      try {
        await operationBarrier.barrier;
        const first = withdrawFirst
          ? withdrawDecision(concurrentId, 1, "Concurrent synthetic withdrawal")
          : approveId(concurrentId);
        await awaitQueuedRpc(withdrawFirst ? "withdraw_decision" : "approve_decision");
        const second = withdrawFirst
          ? approveId(concurrentId)
          : withdrawDecision(concurrentId, 1, "Concurrent synthetic withdrawal");
        const [one, two, code] = await Promise.all([first, second, operationBarrier.done]);
        assert.equal(code, 0);
        const withdrawn = withdrawFirst ? one : two,
          approved = withdrawFirst ? two : one;
        const finalStatus = sql(`select status from private.decisions where id='${concurrentId}';`);
        assert.equal(finalStatus, withdrawFirst ? "withdrawn" : "approved");
        if (finalStatus === "approved") {
          assert.equal(approved.status, 200);
          assert.equal(withdrawn.status, 400);
        } else {
          assert.equal(finalStatus, "withdrawn");
          assert.equal(withdrawn.status, 200);
          assert.equal(approved.status, 400);
        }
        assert.equal(
          sql(`select count(*) from private.decisions where case_id='${concurrentCase}';`),
          "1"
        );
      } finally {
        operationBarrier.close();
      }
    }
    record("native-decision-approve-versus-withdraw-real-api-serialization");

    const revokeWithdrawalCase = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind) values('${revokeWithdrawalCase}','${other.id}','kyc');`
    );
    const revokeWithdrawalProposal = await proposeVersion(revokeWithdrawalCase, 1);
    assert.equal(revokeWithdrawalProposal.status, 200);
    const revokeWithdrawalId = uuid(revokeWithdrawalProposal.data.decision_id);
    const withdrawalBarrier = controlledSql(
      `begin; select internal.lock_evidence_subject('${other.id}'); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update private.staff_roles set revoked_at=clock_timestamp(),revoked_by='${staff.admin.id}' where user_id='${staff.governorB.id}'; commit;`
    );
    try {
      await withdrawalBarrier.barrier;
      const [lateWithdrawal, code] = await Promise.all([
        withdrawDecision(revokeWithdrawalId, 1, "Revoked synthetic withdrawal"),
        withdrawalBarrier.done,
      ]);
      assert.equal(code, 0);
      assert.equal(lateWithdrawal.status, 403);
    } finally {
      withdrawalBarrier.close();
      sql(
        `update private.staff_roles set revoked_at=null,revoked_by=null where user_id='${staff.governorB.id}';`
      );
    }
    assert.equal(
      sql(
        `select status='proposed' and withdrawn_by is null and withdrawn_at is null and withdrawal_reason is null from private.decisions where id='${revokeWithdrawalId}';`
      ),
      "t"
    );
    record("native-decision-withdrawal-role-revoked-during-wait-no-audit-write");
    for (const invalid of [null, 0, -1, 2147483647])
      assert.equal((await proposeVersion(changingCase, invalid)).status, 400);
    const emptyProposal = await proposeVersion(changingCase, 1);
    assert.equal(emptyProposal.status, 200);
    const changingUpload = await rpc(
      "begin_evidence_upload",
      { p_case_id: changingCase, p_purpose: "id_front" },
      other.token
    );
    assert.equal(changingUpload.status, 200);
    assert.equal((await approveId(emptyProposal.data.decision_id)).status, 409);
    assert.equal(
      (await withdrawDecision(emptyProposal.data.decision_id, 2, "Evidence set changed")).status,
      200
    );
    const intentProposal = await proposeVersion(changingCase, 2);
    assert.equal(intentProposal.status, 200);
    assert.equal(
      (
        await rpc(
          "advance_evidence_artifact",
          {
            p_artifact_id: changingUpload.data.artifact_id,
            p_state: "uploaded",
            p_sha256: createHash("sha256").update("submission-mutation").digest("hex"),
            p_size: 1234,
          },
          null,
          true
        )
      ).status,
      200
    );
    assert.equal((await approveId(intentProposal.data.decision_id)).status, 409);
    assert.equal(
      sql(`select version from private.evidence_cases where id='${changingCase}';`),
      "3"
    );
    assert.equal(
      sql(
        `select reviewed_snapshot->0->>'state' from private.decisions where id='${uuid(intentProposal.data.decision_id)}';`
      ),
      "intent"
    );
    assert.equal(
      sql(
        `select status from private.decisions where id='${uuid(intentProposal.data.decision_id)}';`
      ),
      "proposed"
    );
    record("native-evidence-artifact-set-and-state-mutations-invalidate-reviewed-proposal");

    const evidenceRaceCase = randomUUID(),
      evidenceRaceArtifact = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind) values('${evidenceRaceCase}','${other.id}','kyc');`
    );
    const evidenceRaceProposal = await proposeVersion(evidenceRaceCase, 1);
    assert.equal(evidenceRaceProposal.status, 200);
    const mutationBarrier = controlledSql(
      `begin; select internal.lock_evidence_subject('${other.id}'); select id from private.evidence_cases where id='${evidenceRaceCase}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key) values('${evidenceRaceArtifact}','${evidenceRaceCase}','${other.id}','id_front','evidence/${evidenceRaceCase}/race'); commit;`
    );
    try {
      await mutationBarrier.barrier;
      const [approvalResult, code] = await Promise.all([
        approveId(evidenceRaceProposal.data.decision_id),
        mutationBarrier.done,
      ]);
      assert.equal(code, 0);
      assert.equal(approvalResult.status, 409);
    } finally {
      mutationBarrier.close();
    }
    assert.equal(
      sql(
        `select version||':'||status from private.evidence_cases where id='${evidenceRaceCase}';`
      ),
      "2:open"
    );
    assert.equal(
      sql(
        `select status||':'||jsonb_array_length(reviewed_snapshot) from private.decisions where id='${uuid(evidenceRaceProposal.data.decision_id)}';`
      ),
      "proposed:0"
    );
    record("native-evidence-upload-versus-approval-real-interleaving");

    const closureEmail = `foundation-closure-${randomUUID()}@example.invalid`,
      closurePassword = randomBytes(24).toString("base64url");
    const closureCreated = await admin.auth.admin.createUser({
      email: closureEmail,
      password: closurePassword,
      email_confirm: true,
    });
    assert.equal(closureCreated.error, null);
    const closureOwner = { id: uuid(closureCreated.data.user.id), member: client(), token: null };
    users.push(closureOwner);
    const closureLogin = await closureOwner.member.auth.signInWithPassword({
      email: closureEmail,
      password: closurePassword,
    });
    assert.equal(closureLogin.error, null);
    closureOwner.token = closureLogin.data.session.access_token;
    const racingClosureCase = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind) values('${racingClosureCase}','${closureOwner.id}','kyc');`
    );
    assert.equal((await acquireEvidenceClaim(staff.governorB, racingClosureCase)).status, 200);
    const closureBarrier = controlledSql(
      `begin; select internal.lock_evidence_subject('${closureOwner.id}'); select id from private.evidence_cases where id='${racingClosureCase}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); select internal.close_account_evidence('${closureOwner.id}'); commit;`
    );
    try {
      await closureBarrier.barrier;
      const [lateUpload, code] = await Promise.all([
        rpc(
          "begin_evidence_upload",
          { p_case_id: racingClosureCase, p_purpose: "selfie" },
          closureOwner.token
        ),
        closureBarrier.done,
      ]);
      assert.equal(code, 0);
      assert.equal(lateUpload.status, 403);
    } finally {
      closureBarrier.close();
    }
    assert.equal(
      sql(`select count(*) from private.evidence_artifacts where case_id='${racingClosureCase}';`),
      "0"
    );
    assert.equal(
      sql(`select status from private.evidence_cases where id='${racingClosureCase}';`),
      "closed"
    );
    record("native-evidence-closure-versus-owner-upload-real-interleaving");
    assert.equal(
      sql(
        `select claimed_by is null and claim_nonce is null and claim_expires_at is null and claim_generation=1 from private.evidence_cases where id='${racingClosureCase}';`
      ),
      "t"
    );

    sql(
      `update private.staff_roles set revoked_at=statement_timestamp(), revoked_by='${staff.admin.id}' where user_id='${staff.moderator.id}';`
    );
    assert.equal(
      (await rpc("claim_evidence_case", { p_case_id: secondCase }, staff.moderator.token)).status,
      403
    );
    sqlFails(
      `update private.staff_roles set revoked_at=statement_timestamp(), revoked_by='${staff.governorB.id}' where user_id='${staff.admin.id}';`,
      "23514"
    );
    record("native-trust-immediate-role-revocation-and-last-admin");

    const revokedHoldBarrier = controlledSql(
      `begin; select internal.lock_evidence_subject('${other.id}'); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update private.staff_roles set revoked_at=clock_timestamp(),revoked_by='${staff.admin.id}' where user_id='${staff.governorC.id}'; commit;`
    );
    try {
      await revokedHoldBarrier.barrier;
      const [lateHold, code] = await Promise.all([
        rpc(
          "place_legal_hold",
          { p_subject_id: other.id, p_reason: "Synthetic revoked hold" },
          staff.governorC.token
        ),
        revokedHoldBarrier.done,
      ]);
      assert.equal(code, 0);
      assert.equal(lateHold.status, 403);
    } finally {
      revokedHoldBarrier.close();
      sql(
        `update private.staff_roles set revoked_at=null,revoked_by=null where user_id='${staff.governorC.id}';`
      );
    }
    assert.equal(
      sql(`select count(*) from private.legal_holds where subject_id='${other.id}';`),
      "0"
    );
    record("native-evidence-hold-role-revocation-during-lock-wait-denial");

    const holdSession = uuid(
      JSON.parse(Buffer.from(staff.governorC.token.split(".")[1], "base64url").toString())
        .session_id
    );
    const priorNotAfter = sql(
      `select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='${holdSession}';`
    );
    const expiredHoldBarrier = controlledSql(
      `begin; select internal.lock_evidence_subject('${other.id}'); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update auth.sessions set not_after=clock_timestamp()-interval '0.5 seconds' where id='${holdSession}'; commit;`
    );
    try {
      await expiredHoldBarrier.barrier;
      const [lateHold, code] = await Promise.all([
        rpc(
          "place_legal_hold",
          { p_subject_id: other.id, p_reason: "Synthetic expired hold" },
          staff.governorC.token
        ),
        expiredHoldBarrier.done,
      ]);
      assert.equal(code, 0);
      assert.equal(lateHold.status, 403);
    } finally {
      expiredHoldBarrier.close();
      sql(`update auth.sessions set not_after=${priorNotAfter} where id='${holdSession}';`);
    }
    assert.equal(
      sql(`select count(*) from private.legal_holds where subject_id='${other.id}';`),
      "0"
    );
    record("native-evidence-hold-session-expiry-during-lock-wait-denial");

    const hold = await rpc(
      "place_legal_hold",
      { p_subject_id: other.id, p_reason: "Synthetic hold check" },
      staff.governorC.token
    );
    nativeStage = "legal hold creation";
    assert.equal(hold.status, 200);
    nativeStage = "legal hold revoked-role denial";
    assert.equal(
      (
        await rpc(
          "place_legal_hold",
          { p_subject_id: other.id, p_reason: "Synthetic hold check" },
          staff.moderator.token
        )
      ).status,
      403
    );
    const abandoned = await rpc(
      "begin_evidence_upload",
      { p_case_id: secondCase, p_purpose: "registration" },
      other.token
    );
    nativeStage = "held account evidence reservation";
    assert.equal(abandoned.status, 200);
    nativeStage = "held evidence aging fixture";
    sql(
      `update private.evidence_artifacts set created_at=statement_timestamp()-interval '2 hours' where id='${uuid(abandoned.data.artifact_id)}'; update private.evidence_artifacts set retain_until=statement_timestamp()-interval '1 second' where id='${artifact}';`
    );
    const heldSweep = await rpc("claim_evidence_cleanup", { p_limit: 50 }, null, true);
    nativeStage = "held evidence cleanup RPC";
    assert.equal(heldSweep.status, 200);
    nativeStage = "held evidence empty cleanup result";
    assert.deepEqual(heldSweep.data, []);
    sql(
      `update private.evidence_artifacts set state='cleanup_required' where id='${uuid(abandoned.data.artifact_id)}';`
    );
    assert.equal(
      (
        await rpc(
          "advance_evidence_artifact",
          { p_artifact_id: abandoned.data.artifact_id, p_state: "deleted" },
          null,
          true
        )
      ).status,
      400
    );
    sql(
      `update private.legal_holds set released_at=statement_timestamp(), released_by='${staff.governorC.id}' where id='${uuid(hold.data.hold_id)}';`
    );
    const sweep = await rpc("claim_evidence_cleanup", { p_limit: 50 }, null, true);
    nativeStage = "released hold exact cleanup result";
    assert.equal(sweep.status, 200);
    assert.deepEqual(
      sweep.data.map((row) => row.artifact_id),
      [artifact]
    );
    nativeStage = "released hold cleanup key binding";
    assert.ok(sweep.data.every((row) => row.object_key.startsWith(`evidence/${caseId}/`)));
    for (const id of [artifact, abandoned.data.artifact_id]) {
      nativeStage =
        id === artifact
          ? "reviewed artifact deletion acknowledgement"
          : "abandoned artifact deletion acknowledgement";
      assert.equal(
        (
          await rpc(
            "advance_evidence_artifact",
            { p_artifact_id: id, p_state: "deleted" },
            null,
            true
          )
        ).status,
        200
      );
    }
    nativeStage = "held-sweep target deletion and unrelated-artifact retention";
    assert.equal(
      sql(
        `select count(*) from private.evidence_artifacts where id in ('${artifact}','${uuid(abandoned.data.artifact_id)}') and state<>'deleted';`
      ),
      "0"
    );
    assert.equal(
      sql(
        `select state from private.evidence_artifacts where id='${uuid(changingUpload.data.artifact_id)}';`
      ),
      "uploaded"
    );
    assert.equal(
      sql(`select state from private.evidence_artifacts where id='${evidenceRaceArtifact}';`),
      "intent"
    );
    record("native-trust-legal-hold-blocks-sweep-and-deletion");
    // DEC-22: identity evidence is kept while the account exists, then 90 days after closure.
    const closureCase = randomUUID();
    const closureArtifact = randomUUID();
    sql(
      `insert into private.evidence_cases(id,subject_id,kind) values('${closureCase}','${owner.id}','kyc'); insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key) values('${closureArtifact}','${closureCase}','${owner.id}','selfie','evidence/${closureCase}/synthetic'); update private.evidence_artifacts set state='uploaded', sha256='${"a".repeat(64)}' where id='${closureArtifact}'; update private.evidence_artifacts set state='clean' where id='${closureArtifact}';`
    );
    assert.equal(
      sql(
        `select retain_until is null from private.evidence_artifacts where id='${closureArtifact}';`
      ),
      "t"
    );
    const closureFingerprint = randomBytes(32).toString("base64url");
    assert.equal(
      (
        await rpc(
          "grant_intro_trial",
          { p_owner: owner.id, p_identity_hmac: closureFingerprint, p_days: 7 },
          null,
          true
        )
      ).data.granted,
      true
    );
    assert.equal(
      (await rpc("close_account_evidence", { p_user_id: owner.id }, other.token)).status,
      403
    );
    const closed = await rpc("close_account_evidence", { p_user_id: owner.id }, null, true);
    assert.equal(closed.status, 200);
    assert.equal(closed.data.scheduled, 1);
    const closedAgain = await rpc("close_account_evidence", { p_user_id: owner.id }, null, true);
    assert.equal(closedAgain.data.closed_at, closed.data.closed_at);
    assert.equal(closedAgain.data.scheduled, 0);
    assert.equal(closed.data.trial_fingerprints_detached, 1);
    assert.equal(closedAgain.data.trial_fingerprints_detached, 0);
    assert.equal(
      sql(
        `select round(extract(epoch from a.retain_until - c.closed_at)/86400)||':'||e.status from private.evidence_artifacts a join private.account_closures c on c.user_id=a.owner_id join private.evidence_cases e on e.id=a.case_id where a.id='${closureArtifact}';`
      ),
      "90:closed"
    );
    const notYetDue = await rpc("claim_evidence_cleanup", { p_limit: 50 }, null, true);
    assert.equal(
      notYetDue.data.some((row) => row.artifact_id === closureArtifact),
      false
    );
    sql(
      `update private.evidence_artifacts set retain_until=statement_timestamp()-interval '1 second' where id='${closureArtifact}';`
    );
    const nowDue = await rpc("claim_evidence_cleanup", { p_limit: 50 }, null, true);
    assert.deepEqual(
      nowDue.data.map((row) => row.artifact_id),
      [closureArtifact]
    );
    record("native-trust-id-retention-90-days-after-account-closure");
    // DEC-27: the trial fingerprint outlives the account by exactly 3 years, detached from it.
    assert.equal(
      sql(
        `select (owner_id is null and entitlement_id is null)||':'||(retain_until = detached_at + interval '3 years')||':'||(detached_at = (select closed_at from private.account_closures where user_id='${owner.id}')) from private.trial_identities where identity_hmac='${closureFingerprint}';`
      ),
      "true:true:true"
    );
    assert.equal(
      (
        await rpc(
          "grant_intro_trial",
          { p_owner: staff.admin.id, p_identity_hmac: closureFingerprint, p_days: 7 },
          null,
          true
        )
      ).data.reason,
      "identity_already_used"
    );
    assert.equal(
      (await rpc("purge_expired_trial_identities", { p_limit: 100 }, other.token)).status,
      403
    );
    assert.equal(
      (await rpc("purge_expired_trial_identities", { p_limit: 100 }, null, true)).data,
      0
    );
    sql(
      `update private.trial_identities set detached_at=detached_at-interval '3 years 1 second', retain_until=retain_until-interval '3 years 1 second' where identity_hmac='${closureFingerprint}';`
    );
    assert.equal(
      (await rpc("purge_expired_trial_identities", { p_limit: 100 }, null, true)).data,
      1
    );
    assert.equal(
      sql(
        `select count(*) from private.trial_identities where identity_hmac='${closureFingerprint}';`
      ),
      "0"
    );
    // After the purge the identity is eligible again, and no other row still
    // carries the fingerprint (an outbox copy once blocked this regrant).
    const regrant = await rpc(
      "grant_intro_trial",
      { p_owner: staff.admin.id, p_identity_hmac: closureFingerprint, p_days: 7 },
      null,
      true
    );
    assert.equal(regrant.status, 200);
    assert.equal(regrant.data.granted, true);
    assert.equal(
      sql(
        `select count(*) from private.outbox_events where dedupe_key like '%${closureFingerprint}%' or subject_id::text like '%${closureFingerprint}%';`
      ),
      "0"
    );
    assert.equal(
      sql(
        `select dedupe_key from private.outbox_events where subject_id='${regrant.data.entitlement_id}';`
      ),
      `trial_started:${regrant.data.entitlement_id}`
    );
    // Concurrent grants for one new identity: exactly one wins.
    const racedFingerprint = createHash("sha256").update(randomUUID()).digest("base64url");
    const racedGrants = await Promise.all(
      [staff.governorB.id, staff.governorC.id].map((ownerId) =>
        rpc(
          "grant_intro_trial",
          { p_owner: ownerId, p_identity_hmac: racedFingerprint, p_days: 7 },
          null,
          true
        )
      )
    );
    assert.deepEqual(
      racedGrants.map((result) => result.status),
      [200, 200]
    );
    assert.deepEqual(
      racedGrants.map((result) => (result.data.granted ? true : result.data.reason)).sort(),
      [true, "identity_already_used"].sort()
    );
    assert.equal(
      sql(
        `select count(*) from private.trial_identities where identity_hmac='${racedFingerprint}';`
      ),
      "1"
    );
    record("native-billing-trial-fingerprint-kept-3-years-after-account-closure");
    // A retained Auth row is not an eligible trial owner after closure. Force
    // both shared-subject lock orders rather than relying on request timing.
    for (const order of ["close_first", "grant_first"]) {
      const created = await admin.auth.admin.createUser({
        email: `foundation-trial-close-${randomUUID()}@example.invalid`,
        password: randomBytes(24).toString("base64url"),
        email_confirm: true,
      });
      assert.equal(created.error, null);
      const member = { id: uuid(created.data.user.id), member: null, token: null };
      users.push(member);
      const fingerprint = randomBytes(32).toString("base64url");
      const firstAction =
        order === "close_first"
          ? `perform internal.close_account_evidence('${member.id}');`
          : `perform internal.grant_intro_trial('${member.id}','${fingerprint}',7);`;
      const barrier = controlledSql(
        `begin; do $test$ begin ${firstAction} end $test$; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); commit;`
      );
      try {
        await barrier.barrier;
        const name = order === "close_first" ? "grant_intro_trial" : "close_account_evidence";
        const pending =
          order === "close_first"
            ? rpc(name, { p_owner: member.id, p_identity_hmac: fingerprint, p_days: 7 }, null, true)
            : rpc(name, { p_user_id: member.id }, null, true);
        await awaitQueuedRpc(name);
        const [result, code] = await Promise.all([pending, barrier.done]);
        assert.equal(code, 0);
        assert.equal(result.status, order === "close_first" ? 403 : 200);
        assert.equal(
          sql(`select count(*) from private.trial_identities where owner_id='${member.id}';`),
          "0"
        );
        assert.equal(
          sql(`select count(*) from private.entitlements where owner_id='${member.id}';`),
          order === "close_first" ? "0" : "1"
        );
        assert.equal(
          sql(`select count(*) from private.outbox_events where owner_id='${member.id}';`),
          order === "close_first" ? "0" : "1"
        );
        if (order === "grant_first")
          assert.equal(
            sql(
              `select detached_at is not null and retain_until=detached_at+interval '3 years' from private.trial_identities where identity_hmac='${fingerprint}';`
            ),
            "t"
          );
        assert.equal(
          (
            await rpc(
              "grant_intro_trial",
              {
                p_owner: member.id,
                p_identity_hmac: randomBytes(32).toString("base64url"),
                p_days: 7,
              },
              null,
              true
            )
          ).status,
          403
        );
      } finally {
        barrier.close();
      }
    }
    record("native-trial-grant-versus-account-closure-both-orders-no-attached-fingerprint");
    assert.equal(
      sql(
        "select bool_and(not has_table_privilege(r,t,'select,insert,update,delete,truncate,references,trigger')) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private.staff_capabilities','private.staff_roles','private.evidence_cases','private.evidence_artifacts','private.legal_holds','private.evidence_access_log','private.decisions','private.account_closures']) t;"
      ),
      "t"
    );
    record("native-trust-private-tables");
    {
      // BF-05: media journal and quota, draft content, funded submission, moderation
      // writing the search projection, owner state changes, refunds and event fair use.
      // Explicit positive cohort: preserve the closed outer owner/other fixtures.
      const publicationOwner = await createTrackedUser("publication-owner");
      const verificationReviewer = await createPostingVerifier({
        createUser: createTrackedUser,
        sql,
        fixtureAdminId: staff.admin.id,
      });
      verificationFixture = createTrustedPostingFixture({
        rpc,
        sql,
        reviewer: verificationReviewer,
      });
      await verificationFixture.ready(publicationOwner);
      const MB = 1024 * 1024;
      const digest = (label) => createHash("sha256").update(label).digest("hex");
      const upload = async (kind, bytes, token = publicationOwner.token) =>
        rpc("begin_media_upload", { p_kind: kind, p_bytes: bytes }, token);
      const finalize = (id, size, mime, width = 800, height = 600) =>
        rpc(
          "finalize_media",
          {
            p_object_id: id,
            p_size: size,
            p_sha256: digest(id),
            p_mime: mime,
            p_width: width,
            p_height: height,
          },
          null,
          true
        );
      assert.equal((await upload("image", 6 * MB)).status, 400);
      assert.equal((await upload("video", 60 * MB)).status, 400);
      // Storage follows the package (DEC-29): (2 x package posts + 10) x 100 MB.
      const storageAllowance = Number(
        sql(`select internal.media_storage_allowance('${publicationOwner.id}');`)
      );
      assert.ok(storageAllowance >= 10 * 100 * MB);
      const quotaFill = Array.from({ length: Math.ceil(storageAllowance / (50 * MB)) }, () =>
        randomUUID()
      );
      sql(
        `insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,state) values ${quotaFill.map((id) => `('${id}','${publicationOwner.id}','video','media/quota/${id}',${50 * MB},${50 * MB},'${"b".repeat(64)}','video/mp4','ready')`).join(",")};`
      );
      assert.equal((await upload("image", MB)).status, 409);
      sql(
        `delete from private.media_objects where id in (${quotaFill.map((id) => `'${id}'`).join(",")});`
      );
      const img1 = (await upload("image", MB)).data;
      const img2 = (await upload("image", MB)).data;
      const vid1 = (await upload("video", 10 * MB)).data;
      const pending = (await upload("image", MB)).data;
      assert.ok(
        img1.object_key.startsWith("media/") && !img1.object_key.includes(publicationOwner.id)
      );
      assert.equal(
        (
          await rpc(
            "finalize_media",
            {
              p_object_id: img1.object_id,
              p_size: 10,
              p_sha256: digest("x"),
              p_mime: "image/png",
              p_width: 1,
              p_height: 1,
            },
            publicationOwner.token
          )
        ).status,
        403
      );
      assert.equal((await finalize(img1.object_id, MB, "image/jpeg")).data.state, "ready");
      assert.equal((await finalize(img2.object_id, MB, "image/webp")).data.state, "ready");
      assert.equal(
        (await finalize(vid1.object_id, 10 * MB, "video/mp4", null, null)).data.state,
        "ready"
      );
      const oversize = (await upload("image", MB)).data;
      assert.equal(
        (await finalize(oversize.object_id, MB + 1, "image/jpeg")).data.state,
        "rejected"
      );
      const wrongType = (await upload("image", MB)).data;
      assert.equal((await finalize(wrongType.object_id, MB, "text/html")).data.state, "rejected");
      // Photos are never refused for their pixel size (the app shrinks to 2560 px).
      const largePhoto = (await upload("image", MB)).data;
      assert.equal(
        (await finalize(largePhoto.object_id, MB, "image/jpeg", 4032, 3024)).data.state,
        "ready"
      );
      record("native-media-limits-quota-and-finalize");

      const draftPost = async () => {
        const id = randomUUID();
        sql(
          `begin; insert into private.posts(id,owner_id,kind,area,category_key) values('${id}','${publicationOwner.id}','listing','market','electronics'); insert into private.listing_details(post_id,price_mode,price_cents,attributes) values('${id}','amount',150000,'{"device_type":"Smartphone","brand":"Samsung"}'); insert into private.post_contacts(post_id,post_kind,channels) values('${id}','listing',array['form']); commit;`
        );
        return id;
      };
      const listing = await draftPost();
      const content = (id, revision, value, token = publicationOwner.token) =>
        rpc(
          "save_post_content",
          { p_post_id: id, p_expected_revision: revision, p_content: value },
          token
        );
      assert.equal((await content(listing, 1, { title: "Hi" }, owner.token)).status, 403);
      assert.equal((await content(listing, 1, { unknown: "x" })).status, 400);
      const unchangedDraft = sql(
        `select row_to_json(p)::text from private.posts p where id='${listing}';`
      );
      for (const revision of [null, 0, -1, 2147483647])
        assert.equal((await content(listing, revision, { title: "Invalid revision" })).status, 400);
      assert.equal((await content(listing, 1, null)).status, 400);
      assert.equal((await content(listing, 1, { title: "Hidden\u202etitle" })).status, 400);
      assert.equal((await content(listing, 1, { title: "😀".repeat(51) })).status, 400);
      assert.equal((await content(listing, 1, { description: "😀".repeat(2501) })).status, 400);
      assert.equal((await content(listing, 1, { locality_label: "😀".repeat(41) })).status, 400);
      assert.equal(
        sql(`select row_to_json(p)::text from private.posts p where id='${listing}';`),
        unchangedDraft
      );
      const whitespacePost = await draftPost();
      const whitespaceSaved = await content(whitespacePost, 1, {
        title: "\t".repeat(5),
        description: "\n".repeat(20),
        province_id: "gp",
        locality_label: "\u00a0".repeat(5),
      });
      assert.equal(whitespaceSaved.status, 200);
      assert.equal(
        sql(
          `select title is null and description is null and locality_label is null from private.posts where id='${whitespacePost}';`
        ),
        "t"
      );
      assert.equal(
        (
          await rpc(
            "submit_post",
            { p_post_id: whitespacePost, p_expected_revision: whitespaceSaved.data.revision },
            publicationOwner.token
          )
        ).status,
        400
      );
      const unicodeSaved = await content(whitespacePost, whitespaceSaved.data.revision, {
        title: "\u00a0" + "😀".repeat(50) + "\u3000",
        description: "\tA synthetic description with boundary whitespace.\n",
        locality_label: "\u00a0Midrand\u3000",
      });
      assert.equal(unicodeSaved.status, 200);
      assert.equal(
        sql(
          `select title='${"😀".repeat(50)}' and description='A synthetic description with boundary whitespace.' and locality_label='Midrand' from private.posts where id='${whitespacePost}';`
        ),
        "t"
      );
      record("native-publication-ecmascript-trim-and-utf16-text-parity");
      assert.equal(
        (await content(listing, 1, { city_id: "gp_johannesburg", locality_label: "Somewhere" }))
          .status,
        400
      );
      let revision = (
        await content(listing, 1, {
          title: "Samsung Galaxy S24 for sale",
          description: "Excellent condition with box and charger, collection in Johannesburg.",
          province_id: "gp",
          city_id: "gp_johannesburg",
        })
      ).data.revision;
      assert.equal(revision, 2);
      const temporaryLocality = await content(listing, revision, {
        locality_label: "Unlisted town",
      });
      assert.equal(temporaryLocality.status, 200);
      revision = temporaryLocality.data.revision;
      assert.equal(sql(`select city_id is null from private.posts where id='${listing}';`), "t");
      const canonicalLocality = await content(listing, revision, { city_id: "gp_johannesburg" });
      assert.equal(canonicalLocality.status, 200);
      revision = canonicalLocality.data.revision;
      assert.equal(
        sql(`select locality_label is null from private.posts where id='${listing}';`),
        "t"
      );
      for (const locality of ["x".repeat(81), "Hidden\u202etown"])
        assert.equal((await content(listing, revision, { locality_label: locality })).status, 400);
      assert.equal((await content(listing, 1, { title: "Stale edit" })).status, 409);
      const setMedia = (id, rev, items) =>
        rpc(
          "set_post_media",
          { p_post_id: id, p_expected_revision: rev, p_items: items },
          publicationOwner.token
        );
      assert.equal((await setMedia(listing, null, [])).status, 400);
      assert.equal((await setMedia(listing, revision, null)).status, 400);
      assert.equal(
        (
          await rpc(
            "submit_post",
            { p_post_id: listing, p_expected_revision: null },
            publicationOwner.token
          )
        ).status,
        400
      );
      const foreign = randomUUID();
      sql(
        `insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,state) values('${foreign}','${owner.id}','image','media/foreign/${foreign}',${MB},${MB},'${"c".repeat(64)}','image/jpeg','ready');`
      );
      for (const items of [
        [{ object_id: foreign, purpose: "cover", position: 0 }],
        [{ object_id: pending.object_id, purpose: "cover", position: 0 }],
        [{ object_id: vid1.object_id, purpose: "cover", position: 0 }],
        [{ object_id: img1.object_id, purpose: "video", position: 0 }],
        [
          { object_id: img1.object_id, purpose: "cover", position: 0 },
          { object_id: img2.object_id, purpose: "cover", position: 1 },
        ],
        [
          { object_id: img1.object_id, purpose: "gallery", position: 0 },
          { object_id: img2.object_id, purpose: "gallery", position: 0 },
        ],
      ])
        assert.equal(
          (await setMedia(listing, revision, items)).status,
          400,
          JSON.stringify(items.map((i) => i.purpose))
        );
      const many = Array.from({ length: 11 }, () => randomUUID());
      sql(
        `insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,state) values ${many.map((id) => `('${id}','${publicationOwner.id}','image','media/many/${id}',${MB},${MB},'${"d".repeat(64)}','image/jpeg','ready')`).join(",")};`
      );
      assert.equal(
        (
          await setMedia(
            listing,
            revision,
            many.map((id, i) => ({ object_id: id, purpose: "gallery", position: i }))
          )
        ).status,
        400
      );
      const media = await setMedia(listing, revision, [
        {
          object_id: img1.object_id,
          purpose: "cover",
          position: 0,
          focal_x: "0.5",
          focal_y: "0.4",
        },
        { object_id: img1.object_id, purpose: "gallery", position: 0 },
        { object_id: img2.object_id, purpose: "gallery", position: 1 },
        { object_id: vid1.object_id, purpose: "video", position: 0 },
      ]);
      assert.equal(media.status, 200);
      revision = media.data.revision;
      record("native-post-content-and-media-links");
      const attrs = (id, rev, value, token = publicationOwner.token) =>
        rpc(
          "save_listing_attributes",
          { p_post_id: id, p_expected_revision: rev, p_attributes: value },
          token
        );
      for (const condition of ["new", "like_new", "good", "fair", "for_parts"]) {
        const partial = await attrs(listing, revision, { condition });
        assert.equal(partial.status, 200);
        revision = partial.data.revision;
        assert.deepEqual(partial.data.attributes, { condition });
        assert.deepEqual(
          (await rpc("get_listing_attributes", { p_post_id: listing }, publicationOwner.token)).data
            .attributes,
          { condition }
        );
      }
      assert.equal(
        sql(
          `select count(*) from unnest(array['property','vehicles','auto_parts','electronics','home_lifestyle','clothing_accessories','sports_hobbies','other_items','farming_agriculture','baby_kids']) category cross join unnest(array['new','like_new','good','fair','for_parts']) choice where internal.validate_listing_attributes(category,jsonb_build_object('condition',choice),false)=jsonb_build_object('condition',choice);`
        ),
        "50"
      );
      assert.equal(
        (
          await rpc(
            "submit_post",
            { p_post_id: listing, p_expected_revision: revision },
            publicationOwner.token
          )
        ).status,
        400
      );
      sqlFails(
        `select internal.validate_listing_attributes('jobs_services','{"condition":"good"}'::jsonb,false);`,
        "22023"
      );
      assert.equal(
        sql(
          `select internal.validate_listing_attributes('auto_parts','{"part_type":"Brake","part_condition":"used","condition":"for_parts"}'::jsonb,true) = '{"part_type":"Brake","part_condition":"used","condition":"for_parts"}'::jsonb;`
        ),
        "t"
      );
      // Farming equipment condition is independent of the common condition.
      assert.equal(
        sql(
          `select internal.validate_listing_attributes('farming_agriculture','{"farm_category":"equipment_machinery","equipment_condition":"refurbished","condition":"good"}'::jsonb,false) = '{"farm_category":"equipment_machinery","equipment_condition":"refurbished","condition":"good"}'::jsonb;`
        ),
        "t"
      );
      sqlFails(
        `select internal.validate_listing_attributes('farming_agriculture','{"farm_category":"equipment_machinery","equipment_condition":"like_new"}'::jsonb,false);`,
        "22023"
      );
      sqlFails(
        `select internal.validate_listing_attributes('farming_agriculture','{"condition":"refurbished"}'::jsonb,false);`,
        "22023"
      );
      // Category transitions keep a common condition where it applies and refuse jobs.
      sql(`begin; update private.posts set category_key='vehicles' where id='${listing}'; commit;`);
      assert.equal(
        sql(
          `select attributes->>'condition' from private.listing_details where post_id='${listing}';`
        ),
        "for_parts"
      );
      sqlFails(
        `begin; update private.posts set category_key='jobs_services' where id='${listing}'; commit;`,
        "22023"
      );
      assert.equal(
        sql(`select category_key from private.posts where id='${listing}';`),
        "vehicles"
      );
      sql(
        `begin; update private.posts set category_key='electronics' where id='${listing}'; commit;`
      );
      record("native-listing-condition-partial-draft-roundtrip-and-distinct-category-contract");
      const beforeAttributes = sql(
        `select attributes::text from private.listing_details where post_id='${listing}';`
      );
      for (const bad of [
        null,
        { owner_id: publicationOwner.id },
        { brand: " " },
        { brand: "😀".repeat(41) },
        { device_type: "Invented" },
        { power_rating: "200W" },
        { condition: null },
        { condition: "used" },
      ])
        assert.equal((await attrs(listing, revision, bad)).status, 400);
      assert.equal((await attrs(listing, null, {})).status, 400);
      assert.equal((await attrs(listing, revision, {}, staff.governorC.token)).status, 400);
      assert.equal(
        sql(`select attributes::text from private.listing_details where post_id='${listing}';`),
        beforeAttributes
      );
      const clearedAttributes = await attrs(listing, revision, {});
      assert.equal(clearedAttributes.status, 200);
      revision = clearedAttributes.data.revision;
      assert.equal(
        (
          await rpc(
            "submit_post",
            { p_post_id: listing, p_expected_revision: revision },
            publicationOwner.token
          )
        ).status,
        400
      );
      const savedAttributes = await attrs(listing, revision, {
        condition: "like_new",
        device_type: "Smartphone",
        brand: " Samsung ",
        original_accessories: false,
      });
      assert.equal(savedAttributes.status, 200);
      revision = savedAttributes.data.revision;
      assert.equal(savedAttributes.data.attributes.brand, "Samsung");
      assert.equal(savedAttributes.data.attributes.original_accessories, false);
      assert.equal((await attrs(listing, revision - 1, {})).status, 409);
      const ownerAttributes = await rpc(
        "get_listing_attributes",
        { p_post_id: listing },
        publicationOwner.token
      );
      assert.deepEqual(ownerAttributes.data.attributes, savedAttributes.data.attributes);
      assert.equal(
        (await rpc("get_listing_attributes", { p_post_id: listing }, staff.governorC.token)).data,
        null
      );
      sqlFails(
        `update private.listing_details set attributes='{"owner_id":"forged"}' where post_id='${listing}';`,
        "22023"
      );
      record("native-listing-attributes-owner-roundtrip-schema-and-required-publication");
      sqlFails(`update private.posts set category_key='property' where id='${listing}';`, "22023");
      assert.equal(
        sql(`select category_key from private.posts where id='${listing}';`),
        "electronics"
      );
      sql(
        `begin; update private.posts set category_key='jobs_services' where id='${listing}'; update private.listing_details set attributes='{"job_type":"part_time","location_type":"remote"}' where post_id='${listing}'; set constraints all immediate; rollback;`
      );
      assert.deepEqual(
        (await rpc("get_listing_attributes", { p_post_id: listing }, publicationOwner.token)).data
          .attributes,
        savedAttributes.data.attributes
      );
      record("native-listing-parent-category-and-attribute-schema-transaction-integrity");

      const submit = (id, rev, token = publicationOwner.token) =>
        rpc("submit_post", { p_post_id: id, p_expected_revision: rev }, token);
      const bare = await draftPost();
      const bareRevision = (
        await content(bare, 1, {
          title: "Bicycle for sale today",
          description: "Mountain bike in good condition, recently serviced and ready to ride.",
          province_id: "gp",
          locality_label: "Midrand",
        })
      ).data.revision;
      assert.equal((await submit(bare, bareRevision)).status, 400); // no photo
      assert.equal((await submit(listing, revision)).status, 402); // no active plan
      const market = billing.data.plans.find((plan) => plan.code === "market_30d");
      const funding = await rpc(
        "start_checkout",
        { p_product_id: market.id },
        publicationOwner.token
      );
      assert.equal(
        (
          await rpc(
            "attach_provider_request",
            { p_payment_id: funding.data.payment_id, p_request_id: "bf05-req-1" },
            null,
            true
          )
        ).status,
        200
      );
      assert.equal(
        await apply({
          payload_sha256: digest(randomUUID()),
          merchant_reference: funding.data.merchant_reference,
          provider_request_id: "bf05-req-1",
          provider_transaction_id: "bf05-txn-1",
          status: "complete",
          amount_cents: 5000,
          currency: "ZAR",
        }),
        "completed"
      );
      const submitted = await submit(listing, revision);
      assert.equal(submitted.status, 200);
      assert.equal(submitted.data.status, "pending_moderation");
      assert.equal((await submit(listing, revision)).status, 400);
      revision = submitted.data.revision;
      record("native-post-submission-rules-and-funding");

      // Every decision needs the reviewer's live queue claim; this helper takes it first.
      const moderate = async (id, rev, decision, token, reason = null) => {
        const claim = await rpc("claim_queue_item", { p_subject: "post", p_id: id }, token);
        return rpc(
          "moderate_post",
          {
            p_post_id: id,
            p_expected_revision: rev,
            p_decision: decision,
            p_reason: reason,
            p_claim_generation: claim.status === 200 ? claim.data.claim_generation : null,
            p_claim_nonce: claim.status === 200 ? claim.data.claim_nonce : null,
          },
          token
        );
      };
      assert.equal(
        (await moderate(listing, revision, "approve", publicationOwner.token)).status,
        403
      );
      assert.equal(
        (await moderate(listing, revision, "approve", staff.moderator.token)).status,
        403
      ); // revoked in BF-08
      assert.equal(
        (await moderate(listing, revision, "approve", staff.governorC.aal1)).status,
        403
      );
      assert.equal(
        (await moderate(listing, revision - 1, "approve", staff.governorC.token)).status,
        409
      );
      assert.equal(
        (await moderate(listing, revision, "reject", staff.governorC.token, "no")).status,
        400
      );
      const ownPost = randomUUID();
      sql(
        `begin; insert into private.posts(id,owner_id,kind,area,category_key,status) values('${ownPost}','${staff.governorC.id}','listing','market','electronics','pending_moderation'); insert into private.listing_details(post_id) values('${ownPost}'); commit;`
      );
      assert.equal((await moderate(ownPost, 1, "approve", staff.governorC.token)).status, 403);
      assert.equal(
        sql(`select count(*) from private.post_search_documents where post_id='${listing}';`),
        "0"
      );
      assert.equal((await moderate(listing, null, "approve", staff.governorC.token)).status, 400);
      assert.equal((await moderate(listing, revision, null, staff.governorC.token)).status, 400);
      const pendingEntitlement = uuid(
        sql(
          `select entitlement_id from private.post_activations where post_id='${listing}' and released_at is null;`
        )
      );
      try {
        sql(
          `update private.entitlements set max_photos=1,max_videos=0 where id='${pendingEntitlement}';`
        );
        assert.equal(
          (await moderate(listing, revision, "approve", staff.governorC.token)).status,
          409
        );
        assert.equal(
          sql(`select status from private.posts where id='${listing}';`),
          "pending_moderation"
        );
      } finally {
        sql(
          `update private.entitlements set max_photos=10,max_videos=1 where id='${pendingEntitlement}';`
        );
      }
      const approved = await moderate(listing, revision, "approve", staff.governorC.token);
      assert.equal(approved.status, 200);
      revision += 1;
      assert.equal(
        sql(
          `select p.visible_until = e.ends_at from private.posts p join private.post_activations a on a.post_id=p.id and a.released_at is null join private.entitlements e on e.id=a.entitlement_id where p.id='${listing}';`
        ),
        "t"
      );
      const found = await search({ q: "galaxy s24", category: "electronics" });
      assert.ok(found.data.items.some((item) => item.id === listing));
      assert.equal(
        (await rpc("release_post", { p_post_id: listing }, publicationOwner.token)).status,
        400
      );
      assert.equal(
        (
          await rpc(
            "set_post_state",
            { p_post_id: listing, p_expected_revision: null, p_action: "pause" },
            publicationOwner.token
          )
        ).status,
        400
      );
      assert.equal((await rpc("get_public_post", { p_id: listing }, null)).data.id, listing);
      assert.equal(
        sql(
          `select count(*) from private.post_activations where post_id='${listing}' and released_at is null;`
        ),
        "1"
      );
      record("native-publication-null-revision-payload-and-live-funding-release-denial");
      const detail = await rpc("get_public_post", { p_id: listing }, null);
      assert.equal(detail.status, 200);
      assert.equal(detail.data.title, "Samsung Galaxy S24 for sale");
      assert.equal(detail.data.media.length, 4);
      assert.equal(detail.data.condition, "like_new");
      assert.equal(JSON.stringify(detail.data).includes(publicationOwner.id), false); // no owner id anywhere
      assert.equal((await rpc("get_public_post", { p_id: bare }, null)).data, null);
      assert.equal(
        sql(
          `select count(*)||':'||max(decision) from private.moderation_log where post_id='${listing}';`
        ),
        "1:approve"
      );
      sqlFails(`delete from private.moderation_log where post_id='${listing}';`, "23514");
      record("native-moderation-publishes-search-projection");
      const attributeSearch = (attributes) =>
        search({ q: "galaxy s24", category: "electronics", attributes });
      const projectedAttributes = await attributeSearch({
        condition: "like_new",
        device_type: "Smartphone",
        original_accessories: false,
      });
      assert.equal(projectedAttributes.status, 200);
      assert.deepEqual(
        projectedAttributes.data.items.map((item) => item.id),
        [listing]
      );
      assert.equal(projectedAttributes.data.total, 1);
      assert.equal(projectedAttributes.data.items[0].condition, "like_new");
      const commonConditionSearch = await search({ q: "galaxy s24", condition: "like_new" });
      assert.deepEqual(
        commonConditionSearch.data.items.map((item) => item.id),
        [listing]
      );
      assert.equal(commonConditionSearch.data.total, 1);
      assert.deepEqual(projectedAttributes.data.facets.categories, { electronics: 1 });
      assert.equal(
        sql(
          `select not(facets ? 'brand') and facets->'original_accessories'='false'::jsonb from private.post_search_documents where post_id='${listing}';`
        ),
        "t"
      );
      record("native-moderation-projects-only-validated-filterable-listing-attributes");

      const assertListingVisibility = async (visible) => {
        const detailResult = await rpc("get_public_post", { p_id: listing }, null);
        const browseResult = await search({ q: "galaxy s24", category: "electronics" });
        assert.equal(detailResult.status, 200);
        assert.equal(browseResult.status, 200);
        assert.equal(detailResult.data?.id === listing, visible);
        assert.equal(
          browseResult.data.items.some((item) => item.id === listing),
          visible
        );
        assert.equal(browseResult.data.total, found.data.total - (visible ? 0 : 1));
        assert.equal(browseResult.data.facets.categories.electronics ?? 0, browseResult.data.total);
      };
      const listingEntitlement = uuid(
        sql(
          `select entitlement_id from private.post_activations where post_id='${listing}' and released_at is null;`
        )
      );
      const applyVisibilityMutation = async (mutation, restore) => {
        try {
          sql(mutation);
          await assertListingVisibility(false);
        } finally {
          sql(restore);
        }
        await assertListingVisibility(true);
      };
      await applyVisibilityMutation(
        `update auth.users set banned_until=statement_timestamp()+interval '1 hour' where id='${publicationOwner.id}';`,
        `update auth.users set banned_until=null where id='${publicationOwner.id}';`
      );
      await applyVisibilityMutation(
        `update auth.users set deleted_at=statement_timestamp() where id='${publicationOwner.id}';`,
        `update auth.users set deleted_at=null where id='${publicationOwner.id}';`
      );
      // Closure permanently revokes canonical proofs. Use its own real verified
      // subject, so later positive publication tests never resurrect revoked facts.
      nativeStage =
        "dedicated verified owner closure visibility and irreversible proof invalidation";
      {
        const closingOwner = await createTrackedUser("publication-closure-owner");
        await verificationFixture.ready(closingOwner);
        const closingCall = async (name, args) => {
          const response = await rpc(name, args, closingOwner.token);
          assert.equal(response.status, 200, "closure publication fixture " + name);
          return response.data;
        };
        let closingPost = await closingCall("create_core_draft", {
          p_kind: "listing",
          p_area: "market",
          p_category_key: "jobs_services",
          p_detail: { contact_channels: ["form"] },
        });
        closingPost = await closingCall("save_core_listing_terms", {
          p_id: closingPost.id,
          p_expected_revision: closingPost.revision,
          p_terms: { price: { mode: "on_request" }, negotiable: false },
        });
        closingPost = await closingCall("save_listing_attributes", {
          p_post_id: closingPost.id,
          p_expected_revision: closingPost.revision,
          p_attributes: { job_type: "full_time", location_type: "remote" },
        });
        closingPost = await closingCall("save_post_content", {
          p_post_id: closingPost.id,
          p_expected_revision: closingPost.revision,
          p_content: {
            title: "Fixture dedicated closure visibility",
            description: "Synthetic isolated closure visibility and proof invalidation.",
            province_id: "gp",
            city_id: "gp_johannesburg",
          },
        });
        sql(
          "insert into private.entitlements(owner_id,source,area,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at) values('" +
            closingOwner.id +
            "','staff_grant','market','" +
            staff.admin.id +
            "',1,10,1,clock_timestamp(),clock_timestamp()+interval '1 hour');"
        );
        closingPost = await closingCall("submit_post", {
          p_post_id: closingPost.id,
          p_expected_revision: closingPost.revision,
        });
        assert.equal(
          (await moderate(closingPost.id, closingPost.revision, "approve", staff.governorC.token))
            .status,
          200
        );
        assert.equal(
          (await rpc("get_public_post", { p_id: closingPost.id }, null)).data.id,
          closingPost.id
        );
        sql(
          "insert into private.account_closures(user_id,evidence_delete_after) values('" +
            closingOwner.id +
            "\',statement_timestamp()+interval \'90 days\');"
        );
        assert.equal((await rpc("get_public_post", { p_id: closingPost.id }, null)).data, null);
        assert.equal((await search({ q: "dedicated closure visibility" })).data.total, 0);
        assert.equal(
          sql("select internal.current_verified_identity('" + closingOwner.id + "') is null;"),
          "t"
        );
        sql("delete from private.account_closures where user_id='" + closingOwner.id + "';");
        assert.equal(
          (await rpc("get_public_post", { p_id: closingPost.id }, null)).data.id,
          closingPost.id
        );
        assert.equal(
          sql("select internal.current_verified_identity('" + closingOwner.id + "') is null;"),
          "t"
        );
      }

      await applyVisibilityMutation(
        `update private.entitlements set status='revoked',revoked_reason='synthetic' where id='${listingEntitlement}';`,
        `update private.entitlements set status='active',revoked_reason=null where id='${listingEntitlement}';`
      );
      await applyVisibilityMutation(
        `update private.entitlements set area='business' where id='${listingEntitlement}';`,
        `update private.entitlements set area='market' where id='${listingEntitlement}';`
      );
      await applyVisibilityMutation(
        `update private.entitlements set max_photos=1,max_videos=0 where id='${listingEntitlement}';`,
        `update private.entitlements set max_photos=10,max_videos=1 where id='${listingEntitlement}';`
      );
      await applyVisibilityMutation(
        `update private.post_activations set released_at=statement_timestamp(),release_reason='owner' where post_id='${listing}' and released_at is null;`,
        `update private.post_activations set released_at=null,release_reason=null where post_id='${listing}' and entitlement_id='${listingEntitlement}';`
      );
      await applyVisibilityMutation(
        `update private.payments set status='refunded' where id='${funding.data.payment_id}';`,
        `update private.payments set status='complete' where id='${funding.data.payment_id}';`
      );
      record("native-public-detail-search-totals-facets-current-account-funding-eligibility");

      const memberPost = await draftPost();
      const memberEntitlement = randomUUID();
      sql(
        `insert into private.entitlements(id,owner_id,source,slot_capacity,max_photos,max_videos,starts_at,ends_at,area) values('${memberEntitlement}','${searchOwner.id}','intro_trial',1,10,1,statement_timestamp(),statement_timestamp()+interval '2 hours','market'); insert into private.entitlement_members(entitlement_id,member_id,added_by) values('${memberEntitlement}','${publicationOwner.id}','${searchOwner.id}');`
      );
      const memberActivation = await rpc(
        "activate_post",
        { p_post_id: memberPost },
        publicationOwner.token
      );
      assert.equal(memberActivation.status, 200);
      assert.equal(memberActivation.data.entitlement_id, memberEntitlement);
      sql(
        `update private.posts set status='live',title='Synthetic shared funding visibility',published_at=statement_timestamp(),visible_until=statement_timestamp()+interval '2 hours' where id='${memberPost}'; insert into private.post_search_documents(post_id,kind,area,category_key,province_id,locality_label,title,published_at,visible_until,is_visible) values('${memberPost}','listing','market','electronics','gp','Midrand','Synthetic shared funding visibility',statement_timestamp(),statement_timestamp()+interval '2 hours',true);`
      );
      assert.equal((await rpc("get_public_post", { p_id: memberPost }, null)).data.id, memberPost);
      sql(
        `delete from private.entitlement_members where entitlement_id='${memberEntitlement}' and member_id='${publicationOwner.id}';`
      );
      assert.equal((await rpc("get_public_post", { p_id: memberPost }, null)).data, null);
      assert.equal((await search({ q: "shared funding visibility" })).data.total, 0);
      const memberReactivation = await rpc(
        "activate_post",
        { p_post_id: memberPost },
        publicationOwner.token
      );
      assert.ok([200, 402, 409].includes(memberReactivation.status));
      assert.notEqual(memberReactivation.data?.entitlement_id, memberEntitlement);
      assert.notEqual(memberReactivation.data?.reused, true);
      // Restore only the named synthetic activation if fallback selected another valid source.
      sql(
        `update private.post_activations set released_at=statement_timestamp(),release_reason='owner' where post_id='${memberPost}' and released_at is null; insert into private.entitlement_members(entitlement_id,member_id,added_by) values('${memberEntitlement}','${publicationOwner.id}','${searchOwner.id}'); insert into private.post_activations(post_id,entitlement_id,owner_id) values('${memberPost}','${memberEntitlement}','${publicationOwner.id}');`
      );
      assert.equal((await rpc("get_public_post", { p_id: memberPost }, null)).data.id, memberPost);
      try {
        sql(
          `update auth.users set banned_until=statement_timestamp()+interval '1 hour' where id='${searchOwner.id}';`
        );
        assert.equal((await rpc("get_public_post", { p_id: memberPost }, null)).data, null);
        assert.equal((await search({ q: "shared funding visibility" })).data.total, 0);
      } finally {
        sql(`update auth.users set banned_until=null where id='${searchOwner.id}';`);
      }
      assert.equal(
        (
          await rpc(
            "set_post_state",
            { p_post_id: memberPost, p_expected_revision: 1, p_action: "pause" },
            publicationOwner.token
          )
        ).status,
        200
      );
      record("native-membership-revocation-no-activation-reuse-and-funding-owner-visibility");
      sql(
        `update private.entitlements set status='revoked',revoked_reason='synthetic_test_complete' where id='${memberEntitlement}';`
      );

      const limitedMediaPost = await draftPost();
      const limitedEntitlement = randomUUID();
      let limitedRevision = (
        await content(limitedMediaPost, 1, {
          title: "Synthetic limited media listing",
          description: "A synthetic description for exact funding media limits.",
          province_id: "gp",
          locality_label: "Midrand",
        })
      ).data.revision;
      const limitedLinks = (items) =>
        rpc(
          "set_post_media",
          { p_post_id: limitedMediaPost, p_expected_revision: limitedRevision, p_items: items },
          publicationOwner.token
        );
      const twoImages = [
        { object_id: img1.object_id, purpose: "cover", position: 0 },
        { object_id: img2.object_id, purpose: "gallery", position: 0 },
      ];
      const draftMedia = await limitedLinks(twoImages);
      assert.equal(draftMedia.status, 200);
      limitedRevision = draftMedia.data.revision;
      sql(
        `insert into private.entitlements(id,owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at,area) values('${limitedEntitlement}','${publicationOwner.id}','staff_grant','${staff.governorC.id}',1,1,0,statement_timestamp(),statement_timestamp()+interval '1 hour','market');`
      );
      assert.equal((await submit(limitedMediaPost, limitedRevision)).status, 400);
      assert.equal(
        sql(
          `select status||':'||revision||':'||(select count(*) from private.post_activations a where a.post_id=p.id and a.released_at is null) from private.posts p where id='${limitedMediaPost}';`
        ),
        `draft:${limitedRevision}:0`
      );
      assert.equal(
        (await rpc("activate_post", { p_post_id: limitedMediaPost }, publicationOwner.token)).data
          .entitlement_id,
        limitedEntitlement
      );
      assert.equal((await limitedLinks(twoImages)).status, 400);
      assert.equal(
        (
          await limitedLinks([
            twoImages[0],
            { object_id: vid1.object_id, purpose: "video", position: 0 },
          ])
        ).status,
        400
      );
      limitedRevision = (await limitedLinks([twoImages[0]])).data.revision;
      const limitedSubmit = await submit(limitedMediaPost, limitedRevision);
      assert.equal(limitedSubmit.status, 200);
      assert.equal(
        (
          await moderate(
            limitedMediaPost,
            limitedSubmit.data.revision,
            "reject",
            staff.governorC.token,
            "Synthetic capacity test complete"
          )
        ).status,
        200
      );
      sqlFails(
        `update private.entitlements set max_photos=0 where id='${limitedEntitlement}';`,
        "23514"
      );
      sqlFails(
        `update private.entitlements set max_videos=11 where id='${limitedEntitlement}';`,
        "23514"
      );
      record("native-media-allowance-from-exact-funding-and-atomic-submit-rollback");
      sql(
        `update private.entitlements set status='revoked',revoked_reason='synthetic_test_complete' where id='${limitedEntitlement}';`
      );

      const paused = await rpc(
        "set_post_state",
        { p_post_id: listing, p_expected_revision: revision, p_action: "pause" },
        publicationOwner.token
      );
      assert.equal(paused.status, 200);
      revision = paused.data.revision;
      assert.equal(
        (await search({ q: "galaxy s24", category: "electronics" })).data.items.some(
          (item) => item.id === listing
        ),
        false
      );
      assert.equal((await rpc("get_public_post", { p_id: listing }, null)).data, null);
      assert.equal((await rpc("my_posting_capacity", {}, publicationOwner.token)).data.active, 0);
      const editedAttributes = await attrs(listing, revision, {
        device_type: "Laptop",
        brand: "Fixture",
        storage_gb: 256,
        original_accessories: true,
      });
      assert.equal(editedAttributes.status, 200);
      revision = editedAttributes.data.revision;
      const bareMedia = await setMedia(bare, bareRevision, [
        { object_id: img2.object_id, purpose: "cover", position: 0 },
      ]);
      const bareSubmitted = await submit(bare, bareMedia.data.revision);
      assert.equal(bareSubmitted.status, 200);
      assert.equal((await submit(listing, revision)).status, 409); // capacity 1 is now taken
      const rejected = await moderate(
        bare,
        bareSubmitted.data.revision,
        "reject",
        staff.governorC.token,
        "Photo does not match the item"
      );
      assert.equal(rejected.status, 200);
      assert.equal(
        sql(`select status||':'||status_reason from private.posts where id='${bare}';`),
        "rejected:Photo does not match the item"
      );
      const resubmitted = await submit(listing, revision);
      assert.equal(resubmitted.status, 200);
      assert.equal(
        (await moderate(listing, resubmitted.data.revision, "approve", staff.governorC.token))
          .status,
        200
      );
      assert.ok((await search({ q: "galaxy s24" })).data.items.some((item) => item.id === listing));
      assert.equal(
        (
          await attributeSearch({ device_type: "Smartphone", original_accessories: false })
        ).data.items.some((item) => item.id === listing),
        false
      );
      const updatedAttributeSearch = await attributeSearch({
        device_type: "Laptop",
        original_accessories: true,
        storage_gb: { min: 128, max: 512 },
      });
      assert.equal(updatedAttributeSearch.status, 200);
      assert.deepEqual(
        updatedAttributeSearch.data.items.map((item) => item.id),
        [listing]
      );
      assert.equal((await rpc("get_public_post", { p_id: listing }, null)).data.condition, null);
      assert.equal((await search({ q: "galaxy s24", condition: "like_new" })).data.total, 0);
      assert.equal(
        sql(
          `select not(facets ? 'condition') from private.post_search_documents where post_id='${listing}';`
        ),
        "t"
      );
      record("native-republication-replaces-old-choice-boolean-and-range-facets");
      record("native-owner-pause-reject-and-resubmit");

      const refund = await rpc(
        "reverse_payment",
        {
          p_payment_id: funding.data.payment_id,
          p_kind: "refunded",
          p_reason: "Synthetic publication refund",
        },
        null,
        true
      );
      assert.equal(refund.data.released_activations, 1);
      assert.equal(
        (await search({ q: "galaxy s24" })).data.items.some((item) => item.id === listing),
        false
      );
      assert.equal(sql(`select status from private.posts where id='${listing}';`), "expired");
      record("native-refund-takes-funded-post-down");

      const eventActivity = reference.activities.find((a) => a.category === "events").key;
      const eventIds = Array.from({ length: 6 }, () => randomUUID());
      sql(
        `begin; insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id) values ${eventIds.map((id, i) => `('${id}','${publicationOwner.id}','event','tourism_events','events','${eventActivity}','Synthetic event ${i + 1}','A synthetic community event used only for fixture checks.','gp','gp_johannesburg')`).join(",")}; insert into private.event_details(post_id,starts_at,ends_at,timezone) values ${eventIds.map((id) => `('${id}',date_trunc('second',statement_timestamp())+interval '2 days',date_trunc('second',statement_timestamp())+interval '3 days','Africa/Johannesburg')`).join(",")}; insert into private.post_media(post_id,object_id,purpose,position) values ${eventIds.map((id) => `('${id}','${img1.object_id}','cover',0)`).join(",")}; insert into private.post_contacts(post_id,post_kind,channels) values ${eventIds.map((id) => `('${id}','event',array['form'])`).join(",")}; commit;`
      );
      const eventResults = [];
      for (const id of eventIds) eventResults.push((await submit(id, 1)).status);
      assert.deepEqual(eventResults, [200, 200, 200, 200, 200, 429]);
      const eventApproved = await moderate(eventIds[0], 2, "approve", staff.governorC.token);
      assert.equal(eventApproved.status, 200);
      assert.equal(
        sql(
          `select p.visible_until = e.ends_at from private.posts p join private.event_details e on e.post_id=p.id where p.id='${eventIds[0]}';`
        ),
        "t"
      );
      record("native-event-fair-use-and-event-window");
      // Jobs have no mandatory photo, and salary disclosure is an explicit mode.
      const jobPost = randomUUID();
      sql(
        `begin; insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id) values('${jobPost}','${publicationOwner.id}','listing','market','jobs_services','Fixture remote vacancy','A synthetic remote vacancy used to verify required job facts.','gp','gp_johannesburg'); insert into private.listing_details(post_id,price_mode,price_cents,attributes) values('${jobPost}','on_request',null,'{"job_type":"full_time","location_type":"remote"}'); insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at) values('${publicationOwner.id}','staff_grant','${staff.governorC.id}',1,10,1,statement_timestamp(),statement_timestamp()+interval '30 days'); insert into private.post_contacts(post_id,post_kind,channels) values('${jobPost}','listing',array['form']); commit;`
      );
      assert.equal((await submit(jobPost, 1)).status, 200);
      assert.equal((await moderate(jobPost, 2, "approve", staff.governorC.token)).status, 200);
      const jobDetail = await rpc("get_public_post", { p_id: jobPost }, null);
      assert.equal(jobDetail.data.media.length, 0);
      assert.equal(jobDetail.data.price_mode, "on_request");
      assert.equal(
        (
          await rpc(
            "set_post_state",
            { p_post_id: jobPost, p_expected_revision: 3, p_action: "pause" },
            publicationOwner.token
          )
        ).status,
        200
      );
      // Free-event fair-use active slot released through the owner lifecycle.
      const existingEventRevision = Number(
        sql(`select revision from private.posts where id='${eventIds[0]}';`)
      );
      assert.equal(
        (
          await rpc(
            "set_post_state",
            {
              p_post_id: eventIds[0],
              p_expected_revision: existingEventRevision,
              p_action: "pause",
            },
            publicationOwner.token
          )
        ).status,
        200
      );
      const videoEvent = randomUUID();
      sql(
        `begin; insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id) values('${videoEvent}','${publicationOwner.id}','event','tourism_events','events','${eventActivity}','Show','Synthetic video-only event for submission parity.','gp','gp_johannesburg'); insert into private.event_details(post_id,starts_at,ends_at,timezone) values('${videoEvent}',date_trunc('second',statement_timestamp())+interval '2 days',date_trunc('second',statement_timestamp())+interval '3 days','Africa/Johannesburg'); insert into private.post_contacts(post_id,post_kind,channels) values('${videoEvent}','event',array['form']); commit;`
      );
      const videoMedia = await setMedia(videoEvent, 1, [
        { object_id: vid1.object_id, purpose: "video", position: 0 },
      ]);
      assert.equal(videoMedia.status, 200);
      assert.equal((await submit(videoEvent, videoMedia.data.revision)).status, 400); // four-character title
      const videoContent = await content(videoEvent, videoMedia.data.revision, {
        title: "Video event fixture",
      });
      const videoSubmitted = await submit(videoEvent, videoContent.data.revision);
      assert.equal(videoSubmitted.status, 200);
      assert.equal(
        (await moderate(videoEvent, videoSubmitted.data.revision, "approve", staff.governorC.token))
          .status,
        200
      );
      const videoDetail = await rpc("get_public_post", { p_id: videoEvent }, null);
      assert.equal(videoDetail.data.media.length, 1);
      assert.equal(videoDetail.data.media[0].kind, "video");
      record("native-publication-job-no-photo-and-event-video-only-parity");

      const stale = (await upload("image", MB)).data;
      const unused = (await upload("image", MB)).data;
      await finalize(unused.object_id, MB, "image/png");
      sql(
        `update private.media_objects set created_at=statement_timestamp()-interval '25 hours' where id in ('${stale.object_id}','${unused.object_id}','${img1.object_id}');`
      );
      const mediaSweep = await rpc("claim_media_cleanup", { p_limit: 100 }, null, true);
      const swept = mediaSweep.data.map((row) => row.object_id);
      for (const id of [stale.object_id, unused.object_id, oversize.object_id, wrongType.object_id])
        assert.ok(swept.includes(id));
      assert.equal(swept.includes(img1.object_id), false); // still used by posts
      assert.equal(
        (
          await rpc(
            "mark_media_deleted",
            {
              p_object_id: stale.object_id,
              p_claim_token: mediaSweep.data.find((row) => row.object_id === stale.object_id)
                .claim_token,
            },
            null,
            true
          )
        ).status,
        200
      );
      assert.equal(
        (
          await rpc(
            "mark_media_deleted",
            { p_object_id: img1.object_id, p_claim_token: randomUUID() },
            null,
            true
          )
        ).status,
        400
      );
      assert.equal(
        sql(
          "select bool_and(not has_table_privilege(r,t,'select,insert,update,delete,truncate,references,trigger')) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private.media_objects','private.post_media','private.moderation_log']) t;"
        ),
        "t"
      );
      record("native-media-cleanup-sweep-and-private-tables");
      const staleClaim = mediaSweep.data.find((row) => row.object_id === stale.object_id);
      assert.equal(
        (
          await rpc(
            "mark_media_deleted",
            { p_object_id: stale.object_id, p_claim_token: staleClaim.claim_token },
            null,
            true
          )
        ).status,
        200
      );
      assert.equal((await rpc("claim_media_cleanup", { p_limit: null }, null, true)).status, 400);
      const oldClaim = mediaSweep.data.find((row) => row.object_id === unused.object_id);
      sql(
        `update private.media_objects set cleanup_lease_until=statement_timestamp()-interval '1 second' where id='${unused.object_id}';`
      );
      const reclaim = await rpc("claim_media_cleanup", { p_limit: 100 }, null, true);
      const newClaim = reclaim.data.find((row) => row.object_id === unused.object_id);
      assert.ok(newClaim);
      assert.notEqual(newClaim.claim_token, oldClaim.claim_token);
      assert.equal(
        (
          await rpc(
            "mark_media_deleted",
            { p_object_id: unused.object_id, p_claim_token: oldClaim.claim_token },
            null,
            true
          )
        ).status,
        400
      );
      assert.equal(
        (
          await rpc(
            "mark_media_deleted",
            { p_object_id: unused.object_id, p_claim_token: newClaim.claim_token },
            null,
            true
          )
        ).status,
        200
      );
      record("native-media-cleanup-lease-reclaim-and-idempotent-ack");
      // Real overlapping transactions: cleanup owns the object lock before a member links it.
      const raceObject = (await upload("image", MB)).data;
      await finalize(raceObject.object_id, MB, "image/png");
      const racePost = await draftPost();
      const controlled = spawn(
        "docker",
        [
          ...dockerArgs,
          "exec",
          "-i",
          container,
          "psql",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
          "-At",
        ],
        { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
      );
      let markerResolve, markerReject;
      const marker = new Promise((resolve, reject) => {
        markerResolve = resolve;
        markerReject = reject;
      });
      let output = "";
      controlled.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("MEDIA_LOCK_HELD")) markerResolve();
      });
      controlled.stderr.resume();
      const completed = new Promise((resolve) => {
        controlled.on("exit", resolve);
        controlled.on("error", () => {
          markerReject(new Error("Local race process failed"));
          resolve(-1);
        });
      });
      const timeout = setTimeout(
        () => markerReject(new Error("Local race barrier timed out")),
        10000
      );
      controlled.stdin.end(
        `begin; select id from private.media_objects where id='${raceObject.object_id}' for update; select 'MEDIA_LOCK_HELD'; select pg_sleep(1.5); update private.media_objects set state='cleanup_required',cleanup_token=gen_random_uuid(),cleanup_lease_until=statement_timestamp()+interval '5 minutes' where id='${raceObject.object_id}'; commit;`
      );
      try {
        await marker;
        const [linked, code] = await Promise.all([
          setMedia(racePost, 1, [
            { object_id: raceObject.object_id, purpose: "cover", position: 0 },
          ]),
          completed,
        ]);
        assert.equal(code, 0);
        assert.equal(linked.status, 400);
        assert.equal(
          sql(`select count(*) from private.post_media where object_id='${raceObject.object_id}';`),
          "0"
        );
        assert.equal(sql(`select revision from private.posts where id='${racePost}';`), "1");
      } finally {
        clearTimeout(timeout);
      }
      record("native-media-cleanup-versus-link-interleaving");
      const storageUsed = () =>
        Number(
          sql(
            `select coalesce(sum(greatest(coalesce(size_bytes,0),declared_bytes)),0) from private.media_objects where owner_id='${publicationOwner.id}' and state<>'deleted';`
          )
        );
      const room =
        Number(sql(`select internal.media_storage_allowance('${publicationOwner.id}');`)) -
        storageUsed();
      const fillers = Array.from({ length: Math.max(1, Math.ceil(room / (50 * MB))) }, () =>
        randomUUID()
      );
      try {
        sql(
          `insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,state) values ${fillers.map((id) => `('${id}','${publicationOwner.id}','video','media/fill/${id}',${50 * MB},${50 * MB},'${"e".repeat(64)}','video/mp4','ready')`).join(",")};`
        );
        assert.equal((await upload("image", 1)).status, 409);
      } finally {
        sql(
          `delete from private.media_objects where id in (${fillers.map((id) => `'${id}'`).join(",")});`
        );
      }
      // Rejected and cleanup-pending bytes count until the object is deleted.
      const rejectedQuota = (await upload("image", MB)).data;
      const beforeRejected = storageUsed();
      assert.equal(
        (await finalize(rejectedQuota.object_id, 200 * MB, "image/jpeg")).data.state,
        "rejected"
      );
      assert.equal(
        sql(`select size_bytes from private.media_objects where id='${rejectedQuota.object_id}';`),
        String(200 * MB)
      );
      assert.equal(storageUsed(), beforeRejected - MB + 200 * MB);
      const rejectedClaim = (
        await rpc("claim_media_cleanup", { p_limit: 100 }, null, true)
      ).data.find((item) => item.object_id === rejectedQuota.object_id);
      assert.ok(rejectedClaim);
      assert.equal(storageUsed(), beforeRejected - MB + 200 * MB);
      assert.equal(
        (
          await rpc(
            "mark_media_deleted",
            { p_object_id: rejectedQuota.object_id, p_claim_token: rejectedClaim.claim_token },
            null,
            true
          )
        ).status,
        200
      );
      assert.equal(storageUsed(), beforeRejected - MB);
      assert.equal((await upload("image", 1)).status, 200);
      record("native-media-quota-counts-rejected-and-cleanup-pending-bytes");
      // Any table with a foreign key to media_objects keeps its objects out of cleanup
      // (avatars, logos and report attachments later), not just post_media.
      sql(
        `create table private.zz_media_consumer_probe (id uuid primary key default gen_random_uuid(), avatar_object_id uuid not null references private.media_objects(id));`
      );
      try {
        const avatar = (await upload("image", MB)).data;
        assert.equal((await finalize(avatar.object_id, MB, "image/png")).data.state, "ready");
        sql(
          `insert into private.zz_media_consumer_probe(avatar_object_id) values('${avatar.object_id}'); update private.media_objects set created_at=statement_timestamp()-interval '25 hours' where id='${avatar.object_id}';`
        );
        assert.equal(sql(`select internal.media_object_in_use('${avatar.object_id}');`), "t");
        const heldByConsumer = await rpc("claim_media_cleanup", { p_limit: 100 }, null, true);
        assert.equal(
          heldByConsumer.data.some((row) => row.object_id === avatar.object_id),
          false
        );
        sql(`delete from private.zz_media_consumer_probe;`);
        const releasedByConsumer = await rpc("claim_media_cleanup", { p_limit: 100 }, null, true);
        const avatarClaim = releasedByConsumer.data.find(
          (row) => row.object_id === avatar.object_id
        );
        assert.ok(avatarClaim);
        assert.equal(
          (
            await rpc(
              "mark_media_deleted",
              { p_object_id: avatar.object_id, p_claim_token: avatarClaim.claim_token },
              null,
              true
            )
          ).status,
          200
        );
      } finally {
        sql(`drop table if exists private.zz_media_consumer_probe;`);
      }
      // Guard: every *_object_id column in private/api must be a foreign key to media_objects.
      assert.equal(
        sql(
          `select count(*) from information_schema.columns c where c.table_schema in ('private','api') and c.column_name like '%object_id' and not exists (select 1 from pg_constraint k join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1] where k.contype='f' and k.confrelid='private.media_objects'::regclass and k.conrelid=(quote_ident(c.table_schema)||'.'||quote_ident(c.table_name))::regclass and a.attname=c.column_name);`
        ),
        "0"
      );
      record("native-media-cleanup-honours-every-foreign-key-consumer");

      const sessionOf = (member) =>
        uuid(
          JSON.parse(Buffer.from(member.token.split(".")[1], "base64url").toString()).session_id
        );
      const sessionExpiry = (member) =>
        sql(
          `select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='${sessionOf(member)}';`
        );
      const restoreSession = (member, previous) =>
        sql(`update auth.sessions set not_after=${previous} where id='${sessionOf(member)}';`);
      // Live edits (source content edit requests): the approved version stays
      // public while an edit copy is reviewed; approval merges it in one commit.
      const editListing = await draftPost();
      let editRevision = (
        await content(editListing, 1, {
          title: "Original phone listing",
          description: "Original description of a phone for sale, collection in Johannesburg.",
          province_id: "gp",
          city_id: "gp_johannesburg",
        })
      ).data.revision;
      editRevision = (
        await setMedia(editListing, editRevision, [
          { object_id: img1.object_id, purpose: "cover", position: 0 },
        ])
      ).data.revision;
      sql(
        `insert into private.entitlements(owner_id,source,area,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at) values('${publicationOwner.id}','staff_grant','market','${staff.admin.id}',3,10,1,statement_timestamp()-interval '1 day',statement_timestamp()+interval '2 days');`
      );
      const editSubmitted = await submit(editListing, editRevision);
      assert.equal(editSubmitted.status, 200);
      assert.equal(
        (await moderate(editListing, editSubmitted.data.revision, "approve", staff.governorC.token))
          .status,
        200
      );
      let liveRevision = editSubmitted.data.revision + 1;
      const liveTitle = async () =>
        (await rpc("get_public_post", { p_id: editListing }, null)).data?.title ?? null;
      assert.equal(await liveTitle(), "Original phone listing");
      const liveWindow = sql(
        `select published_at||'/'||visible_until from private.posts where id='${editListing}';`
      );
      const createEdit = (id, rev, token = publicationOwner.token) =>
        rpc("create_post_edit", { p_post_id: id, p_expected_revision: rev }, token);
      assert.equal((await createEdit(editListing, liveRevision, searchOwner.token)).status, 400);
      assert.equal((await createEdit(editListing, liveRevision - 1)).status, 409);
      assert.equal((await createEdit(editListing, null)).status, 400);
      const firstEdit = await createEdit(editListing, liveRevision);
      assert.equal(firstEdit.status, 200);
      assert.equal(firstEdit.data.edits_remaining, 2);
      const editId = firstEdit.data.id;
      assert.equal((await createEdit(editListing, liveRevision)).status, 409); // one open edit
      assert.equal(
        sql(
          `select (e.title,e.city_id,d.price_cents,d.attributes,(select count(*) from private.post_media m where m.post_id=e.id))::text = (o.title,o.city_id,od.price_cents,od.attributes,(select count(*) from private.post_media m where m.post_id=o.id))::text from private.posts e join private.listing_details d on d.post_id=e.id join private.posts o on o.id=e.edit_of join private.listing_details od on od.post_id=o.id where e.id='${editId}';`
        ),
        "t"
      );
      // The normal draft commands change the copy; the live version stays public.
      const copyContent = await content(editId, 1, {
        title: "Edited phone listing",
        description: "Edited description of the phone, now with a new case included.",
      });
      assert.equal(copyContent.status, 200);
      const copyAttrs = await attrs(editId, copyContent.data.revision, {
        device_type: "Smartphone",
        brand: "Samsung",
        condition: "like_new",
      });
      assert.equal(copyAttrs.status, 200);
      const copyMedia = await setMedia(editId, copyAttrs.data.revision, [
        { object_id: img2.object_id, purpose: "cover", position: 0 },
        { object_id: img1.object_id, purpose: "gallery", position: 0 },
      ]);
      assert.equal(copyMedia.status, 200);
      assert.equal(await liveTitle(), "Original phone listing");
      // While an edit is open the live post's content, details and links are frozen.
      sqlFails(
        `update private.posts set title='Direct change' where id='${editListing}';`,
        "23514"
      );
      sqlFails(
        `update private.listing_details set price_cents=1 where post_id='${editListing}';`,
        "23514"
      );
      sqlFails(`delete from private.post_media where post_id='${editListing}';`, "23514");
      sqlFails(`update private.posts set edit_of=null where id='${editId}';`, "23514");
      const editFunding = uuid(
        sql(
          `select entitlement_id from private.post_activations where post_id='${editListing}' and released_at is null;`
        )
      );
      sqlFails(
        `insert into private.post_activations(post_id,entitlement_id,owner_id) values('${editId}','${editFunding}','${publicationOwner.id}');`,
        "23514"
      );
      // Submission is checked against the live post's funding; no slot is used.
      const slotsBefore = sql(
        `select count(*) from private.post_activations where owner_id='${publicationOwner.id}' and released_at is null;`
      );
      const editSubmit = await submit(editId, copyMedia.data.revision);
      assert.equal(editSubmit.status, 200);
      assert.equal(
        sql(
          `select count(*) from private.post_activations where owner_id='${publicationOwner.id}' and released_at is null;`
        ),
        slotsBefore
      );
      assert.equal(await liveTitle(), "Original phone listing");
      // Review DTO: the copy beside the live version, only with the live claim.
      const editClaim = await rpc(
        "claim_queue_item",
        { p_subject: "post", p_id: editId },
        staff.governorC.token
      );
      assert.equal(editClaim.status, 200);
      assert.equal(editClaim.data.edit_of, editListing);
      const reviewPost = (claim, token = staff.governorC.token) =>
        rpc(
          "staff_review_post",
          {
            p_post_id: claim.id,
            p_claim_generation: claim.claim_generation,
            p_claim_nonce: claim.claim_nonce,
          },
          token
        );
      const review = await reviewPost(editClaim.data);
      assert.equal(review.status, 200);
      assert.equal(review.data.title, "Edited phone listing");
      assert.equal(review.data.attributes.condition, "like_new");
      assert.equal(review.data.live_version.title, "Original phone listing");
      assert.equal(review.data.media.length, 2);
      assert.equal(
        (await reviewPost({ ...editClaim.data, claim_nonce: randomUUID() })).status,
        403
      );
      assert.equal((await reviewPost(editClaim.data, staff.governorB.token)).status, 403);
      assert.equal((await reviewPost(editClaim.data, publicationOwner.token)).status, 403);
      // Rejection keeps the live version; the owner fixes and resubmits the copy.
      const rejectedEdit = await moderate(
        editId,
        editSubmit.data.revision,
        "reject",
        staff.governorC.token,
        "Photo does not match the item"
      );
      assert.equal(rejectedEdit.status, 200);
      assert.equal(rejectedEdit.data.status, "rejected");
      assert.equal(rejectedEdit.data.edit_of, editListing);
      assert.equal(await liveTitle(), "Original phone listing");
      assert.equal(
        sql(
          `select count(*) from private.moderation_log where post_id='${editListing}' and edit_id='${editId}' and decision='reject';`
        ),
        "1"
      );
      const resubmittedEdit = await submit(editId, editSubmit.data.revision + 1);
      assert.equal(resubmittedEdit.status, 200);
      // Approval replaces content, details and media at once; the window is kept.
      const mergedEdit = await moderate(
        editId,
        resubmittedEdit.data.revision,
        "approve",
        staff.governorC.token
      );
      assert.equal(mergedEdit.status, 200);
      assert.equal(mergedEdit.data.status, "merged");
      liveRevision += 1;
      assert.equal(mergedEdit.data.post_revision, liveRevision);
      assert.equal(await liveTitle(), "Edited phone listing");
      const mergedDetail = (await rpc("get_public_post", { p_id: editListing }, null)).data;
      assert.equal(mergedDetail.condition, "like_new");
      assert.equal(
        mergedDetail.media.find((item) => item.purpose === "cover").object_key,
        sql(`select object_key from private.media_objects where id='${img2.object_id}';`)
      );
      assert.equal(
        sql(
          `select published_at||'/'||visible_until from private.posts where id='${editListing}';`
        ),
        liveWindow
      );
      assert.equal(
        sql(`select count(*) from private.posts where id='${editId}' or edit_of='${editListing}';`),
        "0"
      );
      assert.ok(
        (await search({ q: "edited phone", condition: "like_new" })).data.items.some(
          (item) => item.id === editListing
        )
      );
      // Owner discard leaves the live post unchanged.
      const secondEdit = await createEdit(editListing, liveRevision);
      assert.equal(secondEdit.status, 200);
      assert.equal(secondEdit.data.edits_remaining, 1);
      const discard = (id, rev, token = publicationOwner.token) =>
        rpc("discard_post_edit", { p_edit_id: id, p_expected_revision: rev }, token);
      assert.equal((await discard(secondEdit.data.id, 2)).status, 409);
      assert.equal((await discard(secondEdit.data.id, 1, searchOwner.token)).status, 400);
      assert.equal((await discard(secondEdit.data.id, 1)).status, 200);
      assert.equal(await liveTitle(), "Edited phone listing");
      // A funding change since submission stops the merge; restoring it allows it.
      const thirdEdit = await createEdit(editListing, liveRevision);
      assert.equal(thirdEdit.status, 200);
      const thirdContent = await content(thirdEdit.data.id, 1, {
        title: "Second edit of the phone",
      });
      const thirdSubmit = await submit(thirdEdit.data.id, thirdContent.data.revision);
      assert.equal(thirdSubmit.status, 200);
      const fundedPhotos = sql(
        `select max_photos from private.entitlements where id='${editFunding}';`
      );
      try {
        sql(`update private.entitlements set max_photos=1 where id='${editFunding}';`);
        assert.equal(
          (
            await moderate(
              thirdEdit.data.id,
              thirdSubmit.data.revision,
              "approve",
              staff.governorC.token
            )
          ).status,
          409
        );
      } finally {
        sql(
          `update private.entitlements set max_photos=${fundedPhotos} where id='${editFunding}';`
        );
      }
      assert.equal(
        (
          await moderate(
            thirdEdit.data.id,
            thirdSubmit.data.revision,
            "approve",
            staff.governorC.token
          )
        ).status,
        200
      );
      liveRevision += 1;
      assert.equal(await liveTitle(), "Second edit of the phone");
      // Edit allowance follows the package (DEC-29): 2 per started 30 days.
      assert.equal(sql(`select internal.approved_edit_count('${editListing}');`), "2");
      assert.equal(sql(`select internal.edit_allowance('${editListing}');`), "2");
      const grantEnds = sql(`select ends_at from private.entitlements where id='${editFunding}';`);
      try {
        sql(
          `update private.entitlements set ends_at=starts_at+interval '90 days' where id='${editFunding}';`
        );
        assert.equal(sql(`select internal.edit_allowance('${editListing}');`), "6");
        sql(
          `update private.entitlements set ends_at=starts_at+interval '180 days' where id='${editFunding}';`
        );
        assert.equal(sql(`select internal.edit_allowance('${editListing}');`), "12");
      } finally {
        sql(`update private.entitlements set ends_at='${grantEnds}' where id='${editFunding}';`);
      }
      // With the allowance used, a content change is refused at submission, but
      // a price-only change is still accepted and does not count.
      const limitEdit = await createEdit(editListing, liveRevision);
      assert.equal(limitEdit.status, 200);
      assert.equal(limitEdit.data.edits_remaining, 0);
      const limitContent = await content(limitEdit.data.id, 1, { title: "Third content change" });
      assert.equal((await submit(limitEdit.data.id, limitContent.data.revision)).status, 409);
      assert.equal((await discard(limitEdit.data.id, limitContent.data.revision)).status, 200);
      const priceEdit = await createEdit(editListing, liveRevision);
      assert.equal(priceEdit.status, 200);
      sql(
        `update private.listing_details set price_cents=120000 where post_id='${priceEdit.data.id}';`
      );
      const priceSubmit = await submit(priceEdit.data.id, 1);
      assert.equal(priceSubmit.status, 200);
      const priceMerge = await moderate(
        priceEdit.data.id,
        priceSubmit.data.revision,
        "approve",
        staff.governorC.token
      );
      assert.equal(priceMerge.status, 200);
      assert.equal(priceMerge.data.price_only, true);
      liveRevision += 1;
      assert.equal(sql(`select internal.approved_edit_count('${editListing}');`), "2");
      assert.equal(
        (await rpc("get_public_post", { p_id: editListing }, null)).data.price_cents,
        "120000"
      );
      // One price change per day: a second one within 24 hours is refused.
      liveRevision = Number(sql(`select revision from private.posts where id='${editListing}';`));
      const secondPrice = await createEdit(editListing, liveRevision);
      assert.equal(secondPrice.status, 200);
      sql(
        `update private.listing_details set price_cents=110000 where post_id='${secondPrice.data.id}';`
      );
      assert.equal((await submit(secondPrice.data.id, 1)).status, 429);
      sql(
        `begin; alter table private.moderation_log disable trigger moderation_log_append_only; update private.moderation_log set decided_at=decided_at-interval '25 hours' where post_id='${editListing}' and price_only; alter table private.moderation_log enable trigger moderation_log_append_only; commit;`
      );
      const nextDayPrice = await submit(secondPrice.data.id, 1);
      assert.equal(nextDayPrice.status, 200);
      assert.equal(
        (
          await moderate(
            secondPrice.data.id,
            nextDayPrice.data.revision,
            "approve",
            staff.governorC.token
          )
        ).data.price_only,
        true
      );
      liveRevision = Number(sql(`select revision from private.posts where id='${editListing}';`));
      // Pause keeps an open edit and keeps the paused post frozen; sold/archive
      // discards it. Deleting a post (account deletion) removes its open edit.
      const liveEventFixture = (title) => {
        const id = randomUUID();
        sql(
          `begin; insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id,status,published_at,visible_until) values('${id}','${publicationOwner.id}','event','tourism_events','events','${eventActivity}','${title}','A synthetic live event used for live edit lifecycle checks.','gp','gp_johannesburg','live',statement_timestamp(),statement_timestamp()+interval '3 days'); insert into private.event_details(post_id,starts_at,ends_at,timezone) values('${id}',date_trunc('second',statement_timestamp())+interval '2 days',date_trunc('second',statement_timestamp())+interval '3 days','Africa/Johannesburg'); insert into private.post_media(post_id,object_id,purpose,position) values('${id}','${img1.object_id}','cover',0); insert into private.post_contacts(post_id,post_kind,channels) values('${id}','event',array['form']); commit;`
        );
        return id;
      };
      const eventLive = liveEventFixture("Paused then archived event");
      const ownerDeadline = sessionExpiry(publicationOwner);
      for (const name of [
        "create_post_edit",
        "discard_post_edit",
        "set_post_state",
        "delete_post",
      ]) {
        const target = liveEventFixture(`Owner session wait ${name}`);
        let args = { p_post_id: target, p_expected_revision: 1 };
        if (name === "discard_post_edit") {
          const copy = await createEdit(target, 1);
          assert.equal(copy.status, 200);
          args = { p_edit_id: copy.data.id, p_expected_revision: 1 };
        } else if (name === "set_post_state") args.p_action = "archive";
        const snapshot = () =>
          sql(
            `select jsonb_build_object('post',(select to_jsonb(p) from private.posts p where id='${target}'),'copies',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from private.posts e where edit_of='${target}'),'[]'::jsonb),'media',(select count(*) from private.post_media where post_id='${target}'))::text;`
          );
        const before = snapshot();
        const barrier = controlledSql(
          `begin; select id from private.posts where id='${target}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sessionOf(publicationOwner)}'; commit;`
        );
        try {
          await barrier.barrier;
          const pending = rpc(name, args, publicationOwner.token);
          await awaitQueuedRpc(name);
          const [result, code] = await Promise.all([pending, barrier.done]);
          assert.equal(code, 0);
          assert.equal(result.status, 403);
          assert.equal(snapshot(), before);
        } finally {
          barrier.close();
          restoreSession(publicationOwner, ownerDeadline);
        }
      }
      record("native-owner-edit-state-delete-expired-session-during-wait-rolls-back");
      const eventRevision = 1;
      assert.equal((await createEdit(eventLive, eventRevision)).status, 200);
      const stateChange = (id, rev, action) =>
        rpc(
          "set_post_state",
          { p_post_id: id, p_expected_revision: rev, p_action: action },
          publicationOwner.token
        );
      assert.equal((await stateChange(eventLive, eventRevision, "pause")).status, 200);
      assert.equal(sql(`select count(*) from private.posts where edit_of='${eventLive}';`), "1");
      assert.equal(
        (await content(eventLive, eventRevision + 1, { title: "Direct edit while paused" })).status,
        400
      );
      assert.equal((await stateChange(eventLive, eventRevision + 1, "archive")).status, 200);
      assert.equal(sql(`select count(*) from private.posts where edit_of='${eventLive}';`), "0");
      assert.equal((await createEdit(eventLive, eventRevision + 2)).status, 400);
      const doomed = liveEventFixture("Deleted with its open edit");
      const doomedEdit = await createEdit(doomed, 1);
      assert.equal(doomedEdit.status, 200);
      sql(`delete from private.posts where id='${doomed}';`);
      assert.equal(
        sql(
          `select count(*) from private.posts where id in ('${doomed}','${doomedEdit.data.id}');`
        ),
        "0"
      );
      // Races on one live post, forced in both orders by queueing the second
      // command behind the first on the live post's row lock.
      const claimOne = (subject, id, token) =>
        rpc("claim_queue_item", { p_subject: subject, p_id: id }, token);
      const raceFixture = async (title) => {
        const id = liveEventFixture(title);
        const edit = await createEdit(id, 1);
        assert.equal(edit.status, 200);
        const edited = await content(edit.data.id, 1, { title: `${title} edited` });
        const submitted = await submit(edit.data.id, edited.data.revision);
        assert.equal(submitted.status, 200);
        const claim = await claimOne("post", edit.data.id, staff.governorC.token);
        assert.equal(claim.status, 200);
        return { id, editId: edit.data.id, claim: claim.data };
      };
      const approveRaced = (fixture) =>
        rpc(
          "moderate_post",
          {
            p_post_id: fixture.editId,
            p_expected_revision: fixture.claim.revision,
            p_decision: "approve",
            p_claim_generation: fixture.claim.claim_generation,
            p_claim_nonce: fixture.claim.claim_nonce,
          },
          staff.governorC.token
        );
      for (const [rival, approveFirst] of [
        ["discard", true],
        ["discard", false],
        ["archive", true],
        ["archive", false],
      ]) {
        const fixture = await raceFixture(`Race ${rival} ${approveFirst ? "late" : "early"}`);
        const rivalCall = () =>
          rival === "discard"
            ? discard(fixture.editId, fixture.claim.revision)
            : stateChange(fixture.id, 1, "archive");
        const rivalName = rival === "discard" ? "discard_post_edit" : "set_post_state";
        const raceBarrier = controlledSql(
          `begin; select id from private.posts where id='${fixture.id}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(2); commit;`
        );
        try {
          await raceBarrier.barrier;
          const first = approveFirst ? approveRaced(fixture) : rivalCall();
          await awaitQueuedRpc(approveFirst ? "moderate_post" : rivalName);
          const second = approveFirst ? rivalCall() : approveRaced(fixture);
          const [one, two, code] = await Promise.all([first, second, raceBarrier.done]);
          assert.equal(code, 0);
          const [approved, rivalResult] = approveFirst ? [one, two] : [two, one];
          const merges = sql(
            `select count(*) from private.moderation_log where post_id='${fixture.id}' and edit_id='${fixture.editId}' and decision='approve';`
          );
          if (approveFirst) {
            assert.equal(approved.status, 200);
            assert.equal(approved.data.status, "merged");
            assert.equal(rivalResult.status, rival === "discard" ? 400 : 409); // copy gone / revision moved
            assert.equal(merges, "1");
            assert.equal(
              sql(`select status||':'||title from private.posts where id='${fixture.id}';`),
              `live:Race ${rival} late edited`
            );
          } else {
            assert.equal(rivalResult.status, 200);
            assert.equal(approved.status, 400); // the copy is gone before approval runs
            assert.equal(merges, "0");
            assert.equal(
              sql(`select status||':'||title from private.posts where id='${fixture.id}';`),
              `${rival === "discard" ? "live" : "archived"}:Race ${rival} early`
            );
          }
          assert.equal(
            sql(`select count(*) from private.posts where edit_of='${fixture.id}';`),
            "0"
          );
          assert.equal(
            sql(`select count(*) from private.queue_claims where post_id='${fixture.editId}';`),
            "0"
          );
        } finally {
          raceBarrier.close();
        }
      }
      // Every posts column is classified for create_post_edit/apply_post_edit:
      // identity and content are copied, lifecycle starts fresh. A new column
      // must be classified there before this list changes.
      assert.equal(
        sql(
          "select string_agg(column_name,',' order by column_name collate \"C\") from information_schema.columns where table_schema='private' and table_name='posts';"
        ),
        "activity_key,area,category_key,city_id,content_updated_at,created_at,description,edit_of,id,kind,locality_label,owner_id,province_id,published_at,revision,status,status_changed_at,status_reason,submitted_at,title,visible_until"
      );
      assert.equal((await stateChange(editListing, liveRevision, "archive")).status, 200);
      record("native-live-post-edit-keeps-approved-version-public-and-merges-atomically");

      // Generic queue claims: the evidence-case fence applied to posts and reports.
      const pendingFixture = (count, ownerId = publicationOwner.id) => {
        const ids = Array.from({ length: count }, () => randomUUID());
        sql(
          `begin; insert into private.posts(id,owner_id,kind,area,category_key,status,submitted_at) values ${ids.map((id, i) => `('${id}','${ownerId}','listing','market','electronics','pending_moderation',statement_timestamp()-interval '${i} seconds')`).join(",")}; insert into private.listing_details(post_id) values ${ids.map((id) => `('${id}')`).join(",")}; commit;`
        );
        return ids;
      };
      pendingFixture(6);
      const claimBatch = (token, queue = "content", limit = 3) =>
        rpc("claim_queue_items", { p_queue: queue, p_limit: limit }, token);
      assert.equal((await claimBatch(publicationOwner.token)).status, 403);
      assert.equal((await claimBatch(staff.governorC.aal1)).status, 403);
      assert.equal((await claimBatch(staff.moderator.token)).status, 403); // revoked
      assert.equal((await claimBatch(staff.admin.token)).status, 403); // admins reassign only
      for (const [queue, limit] of [
        ["kyc", 1],
        [null, 1],
        ["content", 0],
        ["content", 26],
        ["content", null],
      ])
        assert.equal((await claimBatch(staff.governorB.token, queue, limit)).status, 400);
      const [batchB, batchC] = await Promise.all([
        claimBatch(staff.governorB.token),
        claimBatch(staff.governorC.token),
      ]);
      assert.equal(batchB.status, 200);
      assert.equal(batchC.status, 200);
      const idsB = batchB.data.map((item) => item.id);
      const idsC = batchC.data.map((item) => item.id);
      assert.equal(idsB.length, 3);
      assert.equal(idsC.length, 3);
      assert.equal(new Set([...idsB, ...idsC]).size, 6); // concurrent claimers get disjoint items
      assert.equal(idsC.includes(ownPost), false); // never one's own post
      for (const item of [...batchB.data, ...batchC.data]) {
        assert.equal(item.subject, "post");
        assert.match(item.claim_generation, /^[1-9][0-9]*$/);
        assert.equal(
          sql(`select status from private.posts where id='${item.id}';`),
          "pending_moderation"
        );
      }
      const decide = (item, token, generation = item.claim_generation, nonce = item.claim_nonce) =>
        rpc(
          "moderate_post",
          {
            p_post_id: item.id,
            p_expected_revision: item.revision,
            p_decision: "reject",
            p_reason: "Synthetic queue fence check",
            p_claim_generation: generation,
            p_claim_nonce: nonce,
          },
          token
        );
      const itemB = batchB.data[0];
      const completeClaimBefore = sql(
        `select row_to_json(q)::text from private.queue_claims q where post_id='${itemB.id}';`
      );
      for (const field of ["claimed_by", "claim_nonce", "claimed_at", "claim_expires_at"])
        sqlFails(
          `update private.queue_claims set ${field}=null where post_id='${itemB.id}';`,
          "23514"
        );
      sqlFails(
        `update private.queue_claims set claim_generation=0 where post_id='${itemB.id}';`,
        "23514"
      );
      sqlFails(
        `update private.queue_claims set claim_expires_at=claimed_at where post_id='${itemB.id}';`,
        "23514"
      );
      sql(
        `begin; update private.queue_claims set claimed_by=null,claim_nonce=null,claimed_at=null,claim_expires_at=null,renewals=0 where post_id='${itemB.id}'; set constraints all immediate; rollback;`
      );
      assert.equal(
        sql(`select row_to_json(q)::text from private.queue_claims q where post_id='${itemB.id}';`),
        completeClaimBefore
      );
      record("native-queue-claim-complete-active-or-cleared-tuple-constraint");
      assert.equal((await decide(itemB, staff.governorC.token)).status, 403); // another's claim
      assert.equal(
        (await decide(itemB, staff.governorB.token, itemB.claim_generation, randomUUID())).status,
        403
      );
      assert.equal(
        (
          await decide(
            itemB,
            staff.governorB.token,
            String(BigInt(itemB.claim_generation) + 1n),
            itemB.claim_nonce
          )
        ).status,
        403
      );
      for (const generation of [null, "0", "01", "-1", "1.5", "9".repeat(20)])
        assert.equal(
          (await decide(itemB, staff.governorB.token, generation, itemB.claim_nonce)).status,
          400
        );
      assert.equal(
        (await decide(itemB, staff.governorB.token, itemB.claim_generation, null)).status,
        400
      );
      assert.equal((await claimOne("post", itemB.id, staff.governorC.token)).status, 409);
      assert.equal((await claimOne("listing", itemB.id, staff.governorB.token)).status, 400);
      assert.equal((await claimOne("post", randomUUID(), staff.governorB.token)).status, 400);
      assert.equal((await claimOne("post", ownPost, staff.governorC.token)).status, 403);
      // The holder may rotate the tuple without extending the lease.
      const rotated = await claimOne("post", itemB.id, staff.governorB.token);
      assert.equal(rotated.status, 200);
      assert.equal(BigInt(rotated.data.claim_generation), BigInt(itemB.claim_generation) + 1n);
      assert.equal(rotated.data.claim_expires_at, itemB.claim_expires_at);
      assert.equal((await decide(itemB, staff.governorB.token)).status, 403); // old tuple
      const renew = (item, token = staff.governorB.token) =>
        rpc(
          "renew_queue_claim",
          {
            p_subject: "post",
            p_id: item.id,
            p_claim_generation: item.claim_generation,
            p_claim_nonce: item.claim_nonce,
          },
          token
        );
      let held = rotated.data;
      for (let left = 3; left >= 0; left -= 1) {
        const renewed = await renew(held);
        assert.equal(renewed.status, 200);
        assert.equal(renewed.data.renewals_left, left);
        assert.equal(renewed.data.claim_nonce, held.claim_nonce);
        held = renewed.data;
      }
      assert.equal((await renew(held)).status, 409); // four renewals at most
      assert.equal((await renew(held, staff.governorC.token)).status, 403);
      // An expired lease cannot be renewed or used; another reviewer takes over.
      sql(
        `update private.queue_claims set claimed_at=clock_timestamp()-interval '20 minutes', claim_expires_at=clock_timestamp()-interval '1 second' where post_id='${itemB.id}';`
      );
      assert.equal((await decide(held, staff.governorB.token)).status, 403);
      assert.equal((await renew(held)).status, 403);
      const takeover = await claimOne("post", itemB.id, staff.governorC.token);
      assert.equal(takeover.status, 200);
      assert.equal(takeover.data.renewals_left, 4);
      assert.ok(BigInt(takeover.data.claim_generation) > BigInt(held.claim_generation));
      assert.ok(
        (await rpc("my_queue_claims", {}, staff.governorC.token)).data.some(
          (item) => item.id === itemB.id && item.claim_nonce === takeover.data.claim_nonce
        )
      );
      assert.equal(
        (await rpc("my_queue_claims", {}, staff.governorB.token)).data.some(
          (item) => item.id === itemB.id
        ),
        false
      );
      // A failed decision keeps the claim; a successful one clears it.
      assert.equal(
        (await decide({ ...takeover.data, revision: 99 }, staff.governorC.token)).status,
        409
      );
      assert.equal(
        sql(`select claimed_by from private.queue_claims where post_id='${itemB.id}';`),
        staff.governorC.id
      );
      assert.equal((await decide(takeover.data, staff.governorC.token)).status, 200);
      assert.equal(
        sql(
          `select (claimed_by is null and claim_nonce is null and claim_generation=${takeover.data.claim_generation})::text from private.queue_claims where post_id='${itemB.id}';`
        ),
        "true"
      );
      // Holder release.
      const itemC = batchC.data[0];
      const release = (item, nonce = item.claim_nonce) =>
        rpc(
          "release_queue_claim",
          {
            p_subject: "post",
            p_id: item.id,
            p_claim_generation: item.claim_generation,
            p_claim_nonce: nonce,
          },
          staff.governorC.token
        );
      assert.equal((await release(itemC, randomUUID())).status, 403);
      assert.equal((await release(itemC)).status, 200);
      assert.equal((await decide(itemC, staff.governorC.token)).status, 403);
      // Governor/admin reassignment with a reason, audited append-only.
      const itemC2 = batchC.data[1];
      const reassign = (item, to, reason, token = staff.admin.token) =>
        rpc(
          "reassign_queue_claim",
          { p_subject: "post", p_id: item.id, p_to: to, p_reason: reason },
          token
        );
      assert.equal(
        (await reassign(itemC2, staff.governorB.id, "Shift handover", staff.moderator.token))
          .status,
        403
      );
      assert.equal((await reassign(itemC2, staff.governorB.id, "no")).status, 400);
      assert.equal((await reassign(itemC2, publicationOwner.id, "Shift handover")).status, 400);
      assert.equal((await reassign(itemC2, staff.governorC.id, "Shift handover")).status, 400);
      assert.equal((await reassign(itemC, staff.governorB.id, "Shift handover")).status, 409);
      const handed = await reassign(itemC2, staff.governorB.id, "Shift handover");
      assert.equal(handed.status, 200);
      assert.equal(handed.data.status, "reassigned");
      assert.equal(handed.data.claim_nonce, undefined); // only the new holder reads it
      assert.equal((await decide(itemC2, staff.governorC.token)).status, 403);
      const handedTuple = (await rpc("my_queue_claims", {}, staff.governorB.token)).data.find(
        (item) => item.id === itemC2.id
      );
      assert.equal(handedTuple.claim_generation, handed.data.claim_generation);
      assert.equal(
        sql(
          `select count(*)||':'||max(event)||':'||max(reason)||':'||bool_and(from_staff='${staff.governorC.id}' and to_staff='${staff.governorB.id}' and actor_id='${staff.admin.id}') from private.queue_claim_events where post_id='${itemC2.id}';`
        ),
        "1:reassigned:Shift handover:true"
      );
      sqlFails(
        `update private.queue_claim_events set reason='Changed reason' where post_id='${itemC2.id}';`,
        "23514"
      );
      sqlFails(`delete from private.queue_claim_events where post_id='${itemC2.id}';`, "23514");
      const freed = await reassign(itemC2, null, "Reviewer unavailable");
      assert.equal(freed.status, 200);
      assert.equal(freed.data.status, "released");
      assert.equal((await decide(handedTuple, staff.governorB.token)).status, 403);
      assert.equal((await reassign(itemC2, null, "Reviewer unavailable")).status, 409);
      // Losing staff access frees the person's claims immediately.
      const itemB2 = batchB.data[1];
      sql(
        `update private.staff_roles set revoked_at=statement_timestamp(), revoked_by='${staff.admin.id}' where user_id='${staff.governorB.id}';`
      );
      try {
        assert.equal(
          sql(
            `select count(*) from private.queue_claims where claimed_by='${staff.governorB.id}';`
          ),
          "0"
        );
        assert.equal((await claimOne("post", itemB2.id, staff.governorC.token)).status, 200);
      } finally {
        sql(
          `update private.staff_roles set revoked_at=null,revoked_by=null where user_id='${staff.governorB.id}';`
        );
      }
      // At most 20 live claims per person.
      pendingFixture(22);
      const heldByC = Number(
        sql(
          `select count(*) from private.queue_claims where claimed_by='${staff.governorC.id}' and claim_expires_at>clock_timestamp();`
        )
      );
      const capBatch = await claimBatch(staff.governorC.token, "content", 25);
      assert.equal(capBatch.status, 200);
      assert.equal(capBatch.data.length, 20 - heldByC);
      assert.equal((await claimBatch(staff.governorC.token, "content", 1)).data.length, 0);
      const spare = uuid(
        sql(
          `select p.id from private.posts p where p.status='pending_moderation' and p.owner_id='${publicationOwner.id}' and not exists(select 1 from private.queue_claims q where q.post_id=p.id and q.claimed_by is not null and q.claim_expires_at>clock_timestamp()) limit 1;`
        )
      );
      assert.equal((await claimOne("post", spare, staff.governorC.token)).status, 429);
      // CR-03: two reassignments to a holder with 19 claims allocate one 20th claim.
      pendingFixture(20);
      const liveOf = (member) =>
        Number(
          sql(
            `select count(*) from private.queue_claims where claimed_by='${member.id}' and claim_expires_at>clock_timestamp();`
          )
        );
      const topUp = await claimBatch(
        staff.governorB.token,
        "content",
        19 - liveOf(staff.governorB)
      );
      assert.equal(topUp.status, 200);
      assert.equal(liveOf(staff.governorB), 19);
      const [handA, handB] = capBatch.data;
      const capBarrier = controlledSql(
        `begin; select pg_advisory_xact_lock(hashtextextended('${staff.governorB.id}',1201)); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(2); commit;`
      );
      try {
        await capBarrier.barrier;
        const firstHand = reassign(handA, staff.governorB.id, "Balance the queue");
        await awaitQueuedRpc("reassign_queue_claim");
        const secondHand = reassign(handB, staff.governorB.id, "Balance the queue");
        const [one, two, code] = await Promise.all([firstHand, secondHand, capBarrier.done]);
        assert.equal(code, 0);
        assert.deepEqual([one.status, two.status].sort(), [200, 429]);
      } finally {
        capBarrier.close();
      }
      assert.equal(liveOf(staff.governorB), 20);
      assert.equal(
        sql(
          `select count(*) from private.queue_claim_events where post_id in ('${handA.id}','${handB.id}');`
        ),
        "1"
      );
      // A renewal held uncommitted must reserve its holder's capacity even
      // after the old committed expiry passes. Without renewal's holder guard
      // acquisition sees19 and creates a twenty-first live claim after commit.
      const expiring = (await rpc("my_queue_claims", {}, staff.governorB.token)).data.find(
        (item) => item.renewals_left === 4
      );
      assert.ok(expiring);
      const excess = pendingFixture(1)[0];
      sql(
        `update private.queue_claims set claim_expires_at=clock_timestamp()+interval '1 second' where post_id='${expiring.id}';`
      );
      const realClaims = JSON.parse(
        Buffer.from(staff.governorB.token.split(".")[1], "base64url").toString()
      );
      const claimsLiteral = JSON.stringify(realClaims).replaceAll("'", "''");
      const renewalBarrier = controlledSql(
        `begin; set local role authenticated; do $test$ begin perform set_config('request.jwt.claims','${claimsLiteral}',true); perform api.renew_queue_claim('post','${expiring.id}','${expiring.claim_generation}','${expiring.claim_nonce}'); end $test$; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); commit;`
      );
      try {
        await renewalBarrier.barrier;
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const pending = claimOne("post", excess, staff.governorB.token);
        await awaitQueuedRpc("claim_queue_item");
        const [result, code] = await Promise.all([pending, renewalBarrier.done]);
        assert.equal(code, 0);
        assert.equal(result.status, 429);
        assert.equal(liveOf(staff.governorB), 20);
        assert.equal(
          sql(
            `select count(*) from private.queue_claims where post_id='${excess}' and claimed_by is not null;`
          ),
          "0"
        );
      } finally {
        renewalBarrier.close();
      }
      record("native-queue-renewal-versus-acquisition-holder-cap-serialization");
      sql(
        `update private.queue_claims set claimed_by=null,claim_nonce=null,claimed_at=null,claim_expires_at=null,renewals=0 where claimed_by in ('${staff.governorC.id}','${staff.governorB.id}');`
      );
      // CR-02: authority is re-derived after the holder-guard wait (role revoked
      // while waiting) and after claim-row waits (session expired while waiting).
      const guardBarrier = controlledSql(
        `begin; select pg_advisory_xact_lock(hashtextextended('${staff.governorC.id}',1201)); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update private.staff_roles set revoked_at=clock_timestamp(),revoked_by='${staff.admin.id}' where user_id='${staff.governorC.id}'; commit;`
      );
      try {
        await guardBarrier.barrier;
        const [lateBatch, code] = await Promise.all([
          claimBatch(staff.governorC.token, "content", 2),
          guardBarrier.done,
        ]);
        assert.equal(code, 0);
        assert.equal(lateBatch.status, 403);
        assert.equal(liveOf(staff.governorC), 0);
      } finally {
        guardBarrier.close();
        sql(
          `update private.staff_roles set revoked_at=null,revoked_by=null where user_id='${staff.governorC.id}';`
        );
      }
      const fenced = await claimOne("post", spare, staff.governorC.token);
      assert.equal(fenced.status, 200);
      const sessionBefore = sessionExpiry(staff.governorC);
      const rowBarrier = controlledSql(
        `begin; select id from private.queue_claims where post_id='${spare}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update auth.sessions set not_after=clock_timestamp()-interval '0.5 seconds' where id='${sessionOf(staff.governorC)}'; commit;`
      );
      try {
        await rowBarrier.barrier;
        const [lateDecision, code] = await Promise.all([
          decide(fenced.data, staff.governorC.token),
          rowBarrier.done,
        ]);
        assert.equal(code, 0);
        assert.equal(lateDecision.status, 403);
      } finally {
        rowBarrier.close();
        restoreSession(staff.governorC, sessionBefore);
      }
      assert.equal(
        sql(
          `select p.status||':'||(q.claimed_by='${staff.governorC.id}')::text||':'||q.claim_generation||':'||(select count(*) from private.moderation_log l where l.post_id=p.id) from private.posts p join private.queue_claims q on q.post_id=p.id where p.id='${spare}';`
        ),
        `pending_moderation:true:${fenced.data.claim_generation}:0`
      );
      // claim_queue_item waiting on an existing claim row, session expired meanwhile.
      const freedRow = itemC.id; // released earlier: its claim row exists and is clear
      const itemBarrier = controlledSql(
        `begin; select id from private.queue_claims where post_id='${freedRow}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update auth.sessions set not_after=clock_timestamp()-interval '0.5 seconds' where id='${sessionOf(staff.governorC)}'; commit;`
      );
      try {
        await itemBarrier.barrier;
        const [lateClaim, code] = await Promise.all([
          claimOne("post", freedRow, staff.governorC.token),
          itemBarrier.done,
        ]);
        assert.equal(code, 0);
        assert.equal(lateClaim.status, 403);
      } finally {
        itemBarrier.close();
        restoreSession(staff.governorC, sessionBefore);
      }
      assert.equal(
        sql(
          `select (claimed_by is null)::text from private.queue_claims where post_id='${freedRow}';`
        ),
        "true"
      );
      sql(
        `update private.queue_claims set claimed_by=null,claim_nonce=null,claimed_at=null,claim_expires_at=null,renewals=0 where claimed_by='${staff.governorC.id}';`
      );
      record("native-queue-claims-disjoint-fenced-leased-capped-and-audited");

      // Reports: server-only intake about a public post, claimed review, resolution.
      const ipHmac = (label) => createHash("sha256").update(label).digest("base64url");
      const reportBody = (overrides = {}) => ({
        p_post_id: videoEvent,
        p_category: "scam",
        p_description: "This event asks for payment outside the platform.",
        p_reporter_ip_hmac: ipHmac("synthetic-ip-1"),
        p_reporter_id: searchOwner.id,
        ...overrides,
      });
      const fileReport = (body) => rpc("submit_report", body, null, true);
      assert.equal((await rpc("submit_report", reportBody(), searchOwner.token)).status, 403);
      for (const bad of [
        { p_category: "spam" },
        { p_category: null },
        { p_description: "Too short" },
        { p_description: "x".repeat(2001) },
        { p_description: "Hidden\u202edescription text" },
        { p_reporter_ip_hmac: "not-an-hmac" },
        { p_post_id: randomUUID() },
        { p_post_id: listing }, // not public now
      ])
        assert.equal((await fileReport(reportBody(bad))).status, 400, JSON.stringify(bad));
      assert.equal(
        (await fileReport(reportBody({ p_reporter_id: publicationOwner.id }))).status,
        400
      ); // own post
      assert.equal((await fileReport(reportBody({ p_reporter_id: owner.id }))).status, 403); // closed account
      const signedInReport = await fileReport(reportBody());
      assert.equal(signedInReport.status, 200);
      assert.equal(
        (await fileReport(reportBody({ p_description: "A second report from the same person." })))
          .status,
        409
      );
      const anonymousReport = await fileReport(
        reportBody({ p_reporter_id: null, p_category: "misleading_info" })
      );
      assert.equal(anonymousReport.status, 200);
      assert.equal((await fileReport(reportBody({ p_reporter_id: null }))).status, 409);
      const staffReport = await fileReport(
        reportBody({
          p_reporter_id: staff.governorB.id,
          p_reporter_ip_hmac: ipHmac("synthetic-ip-2"),
        })
      );
      assert.equal(staffReport.status, 200);
      const reportClaims = await claimBatch(staff.governorB.token, "reports", 25);
      assert.equal(reportClaims.status, 200);
      const reportIds = reportClaims.data.map((item) => item.id);
      assert.ok(reportIds.includes(signedInReport.data.id));
      assert.ok(reportIds.includes(anonymousReport.data.id));
      assert.equal(reportIds.includes(staffReport.data.id), false); // never a report one filed
      assert.equal(
        (await claimOne("report", staffReport.data.id, staff.governorB.token)).status,
        403
      );
      assert.equal(
        sql(
          `select internal.queue_conflict('${publicationOwner.id}',null,'${staffReport.data.id}')::text||internal.queue_conflict('${staff.governorC.id}',null,'${staffReport.data.id}')::text;`
        ),
        "truefalse"
      ); // the subject cannot work a report about themselves
      const signedInClaim = reportClaims.data.find((item) => item.id === signedInReport.data.id);
      const reviewReport = (claim, token = staff.governorB.token) =>
        rpc(
          "staff_review_report",
          {
            p_report_id: claim.id,
            p_claim_generation: claim.claim_generation,
            p_claim_nonce: claim.claim_nonce,
          },
          token
        );
      const reportView = await reviewReport(signedInClaim);
      assert.equal(reportView.status, 200);
      assert.equal(reportView.data.reporter_signed_in, true);
      assert.equal(reportView.data.subject_account_id, publicationOwner.id);
      assert.equal(reportView.data.subject_open_reports, 3);
      assert.equal(reportView.data.post.id, videoEvent);
      const reportText = JSON.stringify(reportView.data);
      assert.equal(reportText.includes(searchOwner.id), false); // reporter identity withheld
      assert.equal(reportText.includes(ipHmac("synthetic-ip-1")), false);
      assert.equal(
        (await reviewReport({ ...signedInClaim, claim_nonce: randomUUID() })).status,
        403
      );
      assert.equal((await reviewReport(signedInClaim, staff.governorC.token)).status, 403);
      const resolve = (claim, outcome, note, token = staff.governorB.token) =>
        rpc(
          "resolve_report",
          {
            p_report_id: claim.id,
            p_claim_generation: claim.claim_generation,
            p_claim_nonce: claim.claim_nonce,
            p_outcome: outcome,
            p_note: note,
          },
          token
        );
      assert.equal((await resolve(signedInClaim, "deleted", "Looked into it")).status, 400);
      assert.equal((await resolve(signedInClaim, "resolved", "no")).status, 400);
      assert.equal(
        (await resolve(signedInClaim, "resolved", "Looked into it", staff.governorC.token)).status,
        403
      );
      assert.equal(
        (await resolve(signedInClaim, "resolved", "Organiser contacted; payment link removed"))
          .status,
        200
      );
      assert.equal((await resolve(signedInClaim, "resolved", "Again closed")).status, 400);
      assert.equal(
        sql(
          `select status||':'||(resolved_by='${staff.governorB.id}')::text||':'||resolution_note from private.reports where id='${signedInReport.data.id}';`
        ),
        "resolved:true:Organiser contacted; payment link removed"
      );
      const anonymousClaim = reportClaims.data.find((item) => item.id === anonymousReport.data.id);
      assert.equal(
        (await resolve(anonymousClaim, "dismissed", "Event details match the organiser")).status,
        200
      );
      // CR-02: resolution re-derives authority after the claim-row wait.
      const lateReportClaim = await claimOne("report", staffReport.data.id, staff.governorC.token);
      assert.equal(lateReportClaim.status, 200);
      const reportSession = sessionExpiry(staff.governorC);
      const reportBarrier = controlledSql(
        `begin; select id from private.queue_claims where report_id='${staffReport.data.id}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(1.5); update auth.sessions set not_after=clock_timestamp()-interval '0.5 seconds' where id='${sessionOf(staff.governorC)}'; commit;`
      );
      try {
        await reportBarrier.barrier;
        const [lateResolve, code] = await Promise.all([
          resolve(
            lateReportClaim.data,
            "dismissed",
            "Late synthetic dismissal",
            staff.governorC.token
          ),
          reportBarrier.done,
        ]);
        assert.equal(code, 0);
        assert.equal(lateResolve.status, 403);
      } finally {
        reportBarrier.close();
        restoreSession(staff.governorC, reportSession);
      }
      assert.equal(
        sql(
          `select status||':'||(resolved_by is null)::text from private.reports where id='${staffReport.data.id}';`
        ),
        "open:true"
      );
      // A resolved report lets the same person report the post again.
      assert.equal((await fileReport(reportBody())).status, 200);
      // Deleting a post keeps its reports on the subject account.
      const [goneId] = pendingFixture(1);
      sql(
        `insert into private.reports(post_id,subject_account_id,category,description,reporter_ip_hmac) values('${goneId}','${publicationOwner.id}','scam','Synthetic report about a post that is deleted.','${ipHmac("synthetic-ip-3")}');`
      );
      sql(`delete from private.posts where id='${goneId}';`);
      assert.equal(
        sql(
          `select count(*) from private.reports where post_id is null and subject_account_id='${publicationOwner.id}';`
        ),
        "1"
      );
      assert.equal(
        sql(
          "select bool_and(not has_table_privilege(r,t,'select,insert,update,delete,truncate,references,trigger')) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private.reports','private.queue_claims','private.queue_claim_events']) t;"
        ),
        "t"
      );
      record("native-reports-server-intake-claimed-review-and-resolution");

      // Owner deletion (DEC-28): the slot is freed at once, the activation
      // history stays so the re-post allowance is not reset, photos can be
      // reused for 24 hours, and an account legal hold blocks deletion.
      const deletable = await draftPost();
      let deleteRevision = (
        await content(deletable, 1, {
          title: "Phone to delete",
          description: "A synthetic listing that its owner deletes while it is live.",
          province_id: "gp",
          city_id: "gp_johannesburg",
        })
      ).data.revision;
      const reusable = (await upload("image", MB)).data;
      assert.equal((await finalize(reusable.object_id, MB, "image/jpeg")).data.state, "ready");
      deleteRevision = (
        await setMedia(deletable, deleteRevision, [
          { object_id: reusable.object_id, purpose: "cover", position: 0 },
        ])
      ).data.revision;
      const deleteSubmit = await submit(deletable, deleteRevision);
      assert.equal(deleteSubmit.status, 200);
      assert.equal(
        (await moderate(deletable, deleteSubmit.data.revision, "approve", staff.governorC.token))
          .status,
        200
      );
      deleteRevision = deleteSubmit.data.revision + 1;
      const deletedFunding = uuid(
        sql(
          `select entitlement_id from private.post_activations where post_id='${deletable}' and released_at is null;`
        )
      );
      const periodCount = () =>
        sql(
          `select count(*) from private.post_activations where entitlement_id='${deletedFunding}' and activated_at > statement_timestamp()-interval '30 days';`
        );
      const periodBefore = periodCount();
      const deletePost = (id, rev, token = publicationOwner.token) =>
        rpc("delete_post", { p_post_id: id, p_expected_revision: rev }, token);
      assert.equal((await deletePost(deletable, deleteRevision, searchOwner.token)).status, 400);
      assert.equal((await deletePost(deletable, deleteRevision - 1)).status, 409);
      const deletionHold = randomUUID();
      sql(
        `insert into private.legal_holds(id,subject_id,reason,placed_by) values('${deletionHold}','${publicationOwner.id}','Synthetic deletion hold','${staff.admin.id}');`
      );
      try {
        assert.equal((await deletePost(deletable, deleteRevision)).status, 409);
      } finally {
        sql(
          `update private.legal_holds set released_at=statement_timestamp(), released_by='${staff.admin.id}' where id='${deletionHold}';`
        );
      }
      assert.equal((await deletePost(deletable, deleteRevision)).status, 200);
      assert.equal(sql(`select count(*) from private.posts where id='${deletable}';`), "0");
      assert.equal(
        sql(
          `select count(*) from private.post_activations where entitlement_id='${deletedFunding}' and post_id is null and release_reason='deleted';`
        ),
        "1"
      );
      assert.equal(periodCount(), periodBefore); // the re-post allowance is not reset
      assert.equal((await rpc("get_public_post", { p_id: deletable }, null)).data, null);
      sql(
        `update private.media_objects set created_at=statement_timestamp()-interval '2 days' where id='${reusable.object_id}';`
      );
      assert.equal(
        sql(
          `select (unlinked_at is not null)::text from private.media_objects where id='${reusable.object_id}';`
        ),
        "true"
      );
      const sweptIds = async () =>
        (await rpc("claim_media_cleanup", { p_limit: 500 }, null, true)).data.map(
          (row) => row.object_id
        );
      assert.equal((await sweptIds()).includes(reusable.object_id), false); // reusable for 24 hours
      const reuseDraft = await draftPost();
      assert.equal(
        (
          await setMedia(reuseDraft, 1, [
            { object_id: reusable.object_id, purpose: "cover", position: 0 },
          ])
        ).status,
        200
      );
      assert.equal((await setMedia(reuseDraft, 2, [])).status, 200);
      sql(
        `update private.media_objects set unlinked_at=statement_timestamp()-interval '25 hours' where id='${reusable.object_id}';`
      );
      assert.ok((await sweptIds()).includes(reusable.object_id));
      record("native-owner-delete-post-keeps-activation-history-and-media-reuse-window");

      // Draft allowance (DEC-29): 5 plus 1 per post in the owner's packages.
      const draftCapacity = () =>
        Number(sql(`select internal.draft_allowance('${searchOwner.id}');`));
      const packagePosts = Number(
        sql(`select posts from internal.package_capacity('${searchOwner.id}');`)
      );
      assert.equal(draftCapacity(), 5 + packagePosts);
      const openDrafts = Number(
        sql(
          `select count(*) from private.posts where owner_id='${searchOwner.id}' and status='draft' and edit_of is null;`
        )
      );
      const extraDrafts = Array.from({ length: Math.max(0, draftCapacity() - openDrafts) }, () =>
        randomUUID()
      );
      if (extraDrafts.length)
        sql(
          `begin; insert into private.posts(id,owner_id,kind,area,category_key) values ${extraDrafts.map((id) => `('${id}','${searchOwner.id}','listing','market','electronics')`).join(",")}; insert into private.listing_details(post_id) values ${extraDrafts.map((id) => `('${id}')`).join(",")}; commit;`
        );
      const newDraft = () =>
        rpc(
          "create_core_draft",
          { p_kind: "listing", p_area: "market", p_category_key: "electronics", p_detail: {} },
          searchOwner.token
        );
      assert.equal((await newDraft()).status, 429);
      sql(
        `insert into private.entitlements(owner_id,source,area,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at) values('${searchOwner.id}','staff_grant','market','${staff.admin.id}',2,10,1,statement_timestamp()-interval '1 day',statement_timestamp()+interval '30 days');`
      );
      assert.equal(draftCapacity(), 5 + packagePosts + 2);
      assert.equal((await newDraft()).status, 200);
      record("native-draft-allowance-follows-package");

      // Lifecycle (DEC-28/29): nothing is kept indefinitely.
      assert.equal(
        (await rpc("run_post_lifecycle", { p_limit: 100 }, publicationOwner.token)).status,
        403
      );
      const lifeEvent = (
        status,
        title,
        ownerId,
        changedDaysAgo,
        published = "null",
        visible = "null"
      ) => {
        const id = randomUUID();
        sql(
          `begin; insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id,status,published_at,visible_until,status_changed_at,content_updated_at) values('${id}','${ownerId}','event','tourism_events','events','${eventActivity}','${title}','A synthetic event for lifecycle sweep checks.','gp','gp_johannesburg','${status}',${published},${visible},statement_timestamp()-interval '${changedDaysAgo} days',statement_timestamp()-interval '${changedDaysAgo} days'); insert into private.event_details(post_id,starts_at,ends_at,timezone) values('${id}',date_trunc('second',statement_timestamp())+interval '2 days',date_trunc('second',statement_timestamp())+interval '3 days','Africa/Johannesburg'); commit;`
        );
        return id;
      };
      const lapsed = lifeEvent(
        "live",
        "Lapsed event",
        publicationOwner.id,
        10,
        "statement_timestamp()-interval '10 days'",
        "statement_timestamp()-interval '1 minute'"
      );
      const expired22 = lifeEvent("expired", "Expired 22 days", publicationOwner.id, 22);
      const expired31 = lifeEvent("expired", "Expired 31 days", publicationOwner.id, 31);
      const archived31 = lifeEvent("archived", "Archived 31 days", publicationOwner.id, 31);
      const draft46 = lifeEvent("draft", "Draft 46 days", publicationOwner.id, 46);
      const draft61 = lifeEvent("draft", "Draft 61 days", publicationOwner.id, 61);
      const paused61 = lifeEvent("paused", "Paused 61 days", publicationOwner.id, 61);
      const pending61 = lifeEvent("pending_moderation", "Pending 61 days", publicationOwner.id, 61);
      const held31 = lifeEvent("archived", "Held 31 days", searchOwner.id, 31);
      const retainedEdits = [];
      for (const [copyStatus, copyAge] of [
        ["pending_moderation", 61],
        ["draft", 1],
      ]) {
        const parent = lifeEvent(
          "expired",
          `Expired parent of ${copyStatus}`,
          publicationOwner.id,
          31
        );
        const copy = randomUUID();
        sql(
          `begin; insert into private.posts(id,owner_id,kind,area,category_key,activity_key,status,edit_of,status_changed_at,content_updated_at) values('${copy}','${publicationOwner.id}','event','tourism_events','events','${eventActivity}','${copyStatus}','${parent}',statement_timestamp()-interval '${copyAge} days',statement_timestamp()-interval '${copyAge} days'); insert into private.event_details(post_id,starts_at,ends_at,timezone) select '${copy}',starts_at,ends_at,timezone from private.event_details where post_id='${parent}'; commit;`
        );
        retainedEdits.push(parent, copy);
      }
      const lifeMedia = (await upload("image", MB)).data;
      assert.equal((await finalize(lifeMedia.object_id, MB, "image/jpeg")).data.state, "ready");
      sql(
        `insert into private.post_media(post_id,object_id,purpose,position) values('${expired31}','${lifeMedia.object_id}','cover',0);`
      );
      const lifeHold = randomUUID();
      sql(
        `insert into private.legal_holds(id,subject_id,reason,placed_by) values('${lifeHold}','${searchOwner.id}','Synthetic lifecycle hold','${staff.admin.id}');`
      );
      const notices = (id) =>
        sql(
          `select coalesce(string_agg(kind,',' order by kind),'') from private.outbox_events where subject_id='${id}';`
        );
      const runLifecycle = async () =>
        (await rpc("run_post_lifecycle", { p_limit: 500 }, null, true)).data;
      try {
        const firstRun = await runLifecycle();
        assert.ok(firstRun.expired >= 1 && firstRun.deleted >= 4);
        assert.equal(sql(`select status from private.posts where id='${lapsed}';`), "expired");
        assert.equal(notices(lapsed), "post_expired");
        assert.equal(notices(expired22), "post_expired,post_expiry_reminder,post_expiry_reminder");
        for (const gone of [expired31, archived31, draft61, paused61])
          assert.equal(sql(`select count(*) from private.posts where id='${gone}';`), "0");
        assert.equal(
          notices(expired31),
          "post_deleted,post_expired,post_expiry_reminder,post_expiry_reminder"
        );
        assert.equal(
          sql(
            `select (unlinked_at is not null)::text from private.media_objects where id='${lifeMedia.object_id}';`
          ),
          "true"
        );
        assert.equal(notices(draft46), "draft_deletion_warning");
        for (const kept of [draft46, pending61, held31])
          assert.equal(sql(`select count(*) from private.posts where id='${kept}';`), "1");
        for (const kept of retainedEdits)
          assert.equal(sql(`select count(*) from private.posts where id='${kept}';`), "1");
        await runLifecycle(); // notices are sent once per state
        assert.equal(notices(expired22), "post_expired,post_expiry_reminder,post_expiry_reminder");
        assert.equal(notices(draft46), "draft_deletion_warning");
      } finally {
        sql(
          `update private.legal_holds set released_at=statement_timestamp(), released_by='${staff.admin.id}' where id='${lifeHold}';`
        );
      }
      await runLifecycle();
      assert.equal(sql(`select count(*) from private.posts where id='${held31}';`), "0");
      record("native-post-lifecycle-expiry-notices-and-timed-deletion");
      // Hold placement owns the account guard before either owner deletion or
      // scheduled cleanup can remove data. A sweep skips a busy subject.
      const heldRace = lifeEvent("archived", "Hold race deletion target", publicationOwner.id, 31);
      const raceHold = randomUUID();
      const holdBarrier = controlledSql(
        `begin; select internal.lock_evidence_subject('${publicationOwner.id}'); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); insert into private.legal_holds(id,subject_id,reason,placed_by) values('${raceHold}','${publicationOwner.id}','Synthetic concurrent hold','${staff.admin.id}'); commit;`
      );
      try {
        await holdBarrier.barrier;
        const deletion = rpc(
          "delete_post",
          { p_post_id: heldRace, p_expected_revision: 1 },
          publicationOwner.token
        );
        await awaitQueuedRpc("delete_post");
        await runLifecycle();
        const [result, code] = await Promise.all([deletion, holdBarrier.done]);
        assert.equal(code, 0);
        assert.equal(result.status, 409);
        assert.equal(sql(`select count(*) from private.posts where id='${heldRace}';`), "1");
      } finally {
        holdBarrier.close();
        sql(
          `update private.legal_holds set released_at=clock_timestamp(),released_by='${staff.admin.id}' where id='${raceHold}';`
        );
      }
      assert.equal(
        (
          await rpc(
            "delete_post",
            { p_post_id: heldRace, p_expected_revision: 1 },
            publicationOwner.token
          )
        ).status,
        200
      );
      record("native-owner-and-lifecycle-deletion-serialize-with-legal-hold");
      for (let index = 0; index < 3; index++)
        lifeEvent("expired", `Bounded notice ${index}`, publicationOwner.id, 22);
      let newNotices = 0;
      for (let index = 0; index < 3; index++) {
        const batch = await rpc("run_post_lifecycle", { p_limit: 1 }, null, true);
        assert.equal(batch.status, 200);
        assert.equal(batch.data.notices, 1);
        newNotices += batch.data.notices;
      }
      assert.equal(newNotices, 3);
      record("native-post-lifecycle-notice-batches-progress-past-existing-dedupes");

      // Cost overview (DEC-29): every measured cost line against its free
      // allowance, the activity behind it, and alarms at 70% and 90%.
      const costOverview = (token = staff.admin.token) => rpc("staff_cost_overview", {}, token);
      const overview = await costOverview();
      assert.equal(overview.status, 200);
      const costLine = (data, metric) => data.lines.find((line) => line.metric === metric);
      assert.ok(Number(costLine(overview.data, "object_storage_bytes").used) > 0);
      assert.equal(costLine(overview.data, "object_storage_bytes").level, "unverified_allowance");
      assert.equal(costLine(overview.data, "object_storage_bytes").measurement, "estimate");
      assert.equal(costLine(overview.data, "object_storage_bytes").percent_of_free, null);
      assert.equal(costLine(overview.data, "worker_requests_day").level, "check_provider");
      assert.equal(costLine(overview.data, "payments_month").level, "allowance_unknown");
      assert.equal((await rpc("check_cost_alarms", {}, null, true)).data, 0);
      assert.ok(Number(costLine(overview.data, "database_bytes").used) > 0);
      assert.ok(overview.data.drivers.accounts >= 3);
      assert.ok(overview.data.largest_storage_accounts.length > 0);
      for (const token of [staff.governorB.token, publicationOwner.token, staff.admin.aal1])
        assert.equal((await costOverview(token)).status, 403);
      assert.equal((await rpc("check_cost_alarms", {}, staff.admin.token)).status, 403);
      const freeDatabase = sql(
        `select free_quantity from private.cost_allowances where metric='database_bytes';`
      );
      try {
        sql(
          `update private.cost_allowances set verified_on=current_date,billing_scope='project',free_quantity=greatest(1,(select used from internal.cost_usage() where metric='database_bytes')) where metric='database_bytes';`
        );
        assert.equal((await rpc("check_cost_alarms", {}, null, true)).data, 2);
        assert.equal((await rpc("check_cost_alarms", {}, null, true)).data, 0); // once per month
        const alarmed = await costOverview();
        assert.equal(costLine(alarmed.data, "database_bytes").level, "critical");
        const databaseAlarms = alarmed.data.open_alarms.filter(
          (alarm) => alarm.metric === "database_bytes"
        );
        assert.deepEqual(databaseAlarms.map((alarm) => alarm.level).sort(), [
          "critical",
          "warning",
        ]);
        const acknowledge = (id, token = staff.admin.token) =>
          rpc("acknowledge_cost_alarm", { p_alarm_id: id }, token);
        assert.equal((await acknowledge(databaseAlarms[0].id, staff.governorB.token)).status, 403);
        const adminDeadline = sessionExpiry(staff.admin);
        const alarmBarrier = controlledSql(
          `begin; select id from private.cost_alarms where id='${databaseAlarms[0].id}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(3); update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sessionOf(staff.admin)}'; commit;`
        );
        try {
          await alarmBarrier.barrier;
          const pending = acknowledge(databaseAlarms[0].id);
          await awaitQueuedRpc("acknowledge_cost_alarm");
          const [result, code] = await Promise.all([pending, alarmBarrier.done]);
          assert.equal(code, 0);
          assert.equal(result.status, 403);
          assert.equal(
            sql(
              `select acknowledged_at is null and acknowledged_by is null from private.cost_alarms where id='${databaseAlarms[0].id}';`
            ),
            "t"
          );
        } finally {
          alarmBarrier.close();
          restoreSession(staff.admin, adminDeadline);
        }
        record("native-cost-acknowledgement-session-expiry-during-wait-rolls-back");
        assert.equal((await acknowledge(databaseAlarms[0].id)).status, 200);
        assert.equal((await acknowledge(databaseAlarms[0].id)).status, 400);
        assert.equal((await costOverview()).data.open_alarms.length, 1);
      } finally {
        sql(
          `update private.cost_allowances set verified_on=null,billing_scope='unverified',free_quantity=${freeDatabase} where metric='database_bytes';`
        );
      }
      assert.equal(
        sql(
          "select bool_and(not has_table_privilege(r,t,'select,insert,update,delete,truncate,references,trigger')) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private.cost_allowances','private.cost_alarms']) t;"
        ),
        "t"
      );
      record("native-cost-overview-measures-usage-and-raises-alarms-once");
      // Completion counts survive reversals and use completion time, even
      // when checkout creation belonged to the preceding billing month.
      const clockBefore = sql(
        `select jsonb_build_object('created_at',created_at,'completed_at',completed_at)::text from private.payments where id='${funding.data.payment_id}';`
      );
      try {
        sql(
          `update private.payments set created_at=date_trunc('month',clock_timestamp())-interval '1 day',completed_at=date_trunc('month',clock_timestamp())-interval '1 day' where id='${funding.data.payment_id}';`
        );
        const earlier = Number(
          sql(`select used from internal.cost_usage() where metric='payments_month';`)
        );
        sql(
          `update private.payments set completed_at=clock_timestamp() where id='${funding.data.payment_id}';`
        );
        assert.equal(
          Number(sql(`select used from internal.cost_usage() where metric='payments_month';`)),
          earlier + 1
        );
      } finally {
        sql(
          `update private.payments set created_at=('${clockBefore}'::jsonb->>'created_at')::timestamptz,completed_at=('${clockBefore}'::jsonb->>'completed_at')::timestamptz where id='${funding.data.payment_id}';`
        );
      }
      const meanProbe = lifeEvent(
        "live",
        "Cost linked-media average",
        publicationOwner.id,
        0,
        "statement_timestamp()",
        "statement_timestamp()+interval '3 days'"
      );
      lifeEvent(
        "live",
        "Cost empty-post average",
        publicationOwner.id,
        0,
        "statement_timestamp()",
        "statement_timestamp()+interval '3 days'"
      );
      sql(
        `insert into private.post_media(post_id,object_id,purpose,position) values('${meanProbe}','${img1.object_id}','cover',0),('${meanProbe}','${img1.object_id}','gallery',0);`
      );
      const linked = JSON.parse(
        sql(
          `select coalesce(jsonb_agg(jsonb_build_object('post',p.id,'object',m.id,'bytes',greatest(coalesce(m.size_bytes,0),m.declared_bytes))),'[]'::jsonb) from private.posts p join private.post_media pm on pm.post_id=p.id join private.media_objects m on m.id=pm.object_id where p.status='live';`
        )
      );
      const perPostObject = new Map(
        linked.map((item) => [`${item.post}:${item.object}`, item.bytes])
      );
      const liveCount = Number(sql(`select count(*) from private.posts where status='live';`));
      const expectedMean = Math.round(
        [...perPostObject.values()].reduce((sum, n) => sum + n, 0) / liveCount
      );
      const accountCase = randomUUID(),
        accountArtifact = randomUUID();
      sql(
        `insert into private.evidence_cases(id,subject_id,kind) values('${accountCase}','${staff.admin.id}','kyc'); insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,size_bytes) values('${accountArtifact}','${accountCase}','${staff.admin.id}','selfie','evidence/${accountCase}/cost-probe',${MB});`
      );
      const measured = await costOverview();
      assert.equal(measured.status, 200);
      assert.equal(Number(measured.data.drivers.average_bytes_per_live_post), expectedMean);
      const evidenceAccount = measured.data.largest_storage_accounts.find(
        (account) => account.account_id === staff.admin.id
      );
      assert.ok(evidenceAccount);
      assert.ok(Number(evidenceAccount.bytes) >= MB);
      record("native-cost-observations-completion-history-and-distinct-storage-accounting");

      const restrictionCase = randomUUID();
      sql(
        `insert into private.evidence_cases(id,subject_id,kind) values('${restrictionCase}','${searchOwner.id}','kyc');`
      );
      const restrictionProposal = await rpc(
        "propose_decision",
        {
          p_case_id: restrictionCase,
          p_expected_version: 1,
          p_action: "restrict_account",
          p_payload: {},
        },
        staff.governorB.token
      );
      assert.equal(restrictionProposal.status, 200);
      const beforeRestriction = (await search({ q: "samsung" })).data.total;
      assert.ok(beforeRestriction > 0);
      assert.equal(
        (
          await withdrawDecision(
            restrictionProposal.data.decision_id,
            1,
            "Synthetic proposal withdrawn"
          )
        ).status,
        200
      );
      assert.equal((await search({ q: "samsung" })).data.total, beforeRestriction);
      const finalRestriction = await rpc(
        "propose_decision",
        {
          p_case_id: restrictionCase,
          p_expected_version: 1,
          p_action: "restrict_account",
          p_payload: {},
        },
        staff.governorB.token
      );
      assert.equal(finalRestriction.status, 200);
      assert.equal((await search({ q: "samsung" })).data.total, beforeRestriction);
      assert.equal(
        (
          await rpc(
            "approve_decision",
            { p_decision_id: finalRestriction.data.decision_id },
            staff.governorC.token
          )
        ).status,
        200
      );
      assert.equal((await search({ q: "samsung" })).data.total, 0);
      assert.deepEqual((await search({ q: "samsung" })).data.facets.categories, {});
      assert.equal((await upload("image", 1, searchOwner.token)).status, 403);
      assert.equal(
        sql(
          `select bool_and(not has_table_privilege(r,t,'select,insert,update,delete')) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private.current_account_access','private.public_eligible_posts']) t;`
        ),
        "t"
      );
      record("native-approved-account-restriction-hides-browse-and-denies-stale-owner-session");
      // Banned identities (DEC-30): a keyed fingerprint of the ID number, kept
      // 5 years after the ban, refuses a new account's trial and verification.
      const banFingerprint = createHash("sha256").update(randomUUID()).digest("base64url");
      const recordBan = (decision, fingerprint, category, token = null, service = true) =>
        rpc(
          "record_identity_ban",
          { p_decision_id: decision, p_identity_hmac: fingerprint, p_category: category },
          token,
          service
        );
      const approvedBan = finalRestriction.data.decision_id;
      assert.equal(
        (await recordBan(approvedBan, banFingerprint, "fraud", staff.admin.token, false)).status,
        403
      );
      assert.equal((await recordBan(approvedBan, "short", "fraud")).status, 400);
      assert.equal((await recordBan(approvedBan, banFingerprint, "thief")).status, 400);
      assert.equal(
        (await recordBan(restrictionProposal.data.decision_id, banFingerprint, "fraud")).status,
        403
      ); // a withdrawn proposal is not a ban
      const firstBan = await recordBan(approvedBan, banFingerprint, "fraud");
      assert.equal(firstBan.status, 200);
      const banBeforeRetry = sql(
        `select row_to_json(b)::text from private.banned_identities b where identity_hmac='${banFingerprint}';`
      );
      const retriedBan = await recordBan(approvedBan, banFingerprint, "fraud");
      assert.equal(retriedBan.status, 200);
      assert.equal(retriedBan.data.retain_until, firstBan.data.retain_until);
      assert.equal((await recordBan(approvedBan, banFingerprint, "fake_listings")).status, 409);
      assert.equal(
        sql(
          `select row_to_json(b)::text from private.banned_identities b where identity_hmac='${banFingerprint}';`
        ),
        banBeforeRetry
      );
      assert.equal(
        sql(
          `select count(*)||':'||max(category)||':'||bool_and(retain_until=banned_at+interval '5 years')::text from private.banned_identities where identity_hmac='${banFingerprint}';`
        ),
        "1:fraud:true"
      );
      const identityStatus = (fingerprint, token = null, service = true) =>
        rpc("identity_status", { p_identity_hmac: fingerprint }, token, service);
      assert.deepEqual((await identityStatus(banFingerprint)).data, {
        banned: true,
        trial_used: false,
      });
      assert.equal((await identityStatus(banFingerprint, staff.admin.token, false)).status, 403);
      assert.equal(
        (
          await rpc(
            "grant_intro_trial",
            { p_owner: staff.governorB.id, p_identity_hmac: banFingerprint, p_days: 7 },
            null,
            true
          )
        ).data.reason,
        "identity_banned"
      );
      const purgeBans = async () =>
        (await rpc("purge_expired_identity_bans", { p_limit: 100 }, null, true)).data;
      assert.equal(await purgeBans(), 0);
      sql(
        `update private.banned_identities set banned_at=banned_at-interval '5 years 1 second', retain_until=retain_until-interval '5 years 1 second' where identity_hmac='${banFingerprint}';`
      );
      assert.equal((await identityStatus(banFingerprint)).data.banned, false);
      assert.equal(
        (
          await rpc(
            "grant_intro_trial",
            { p_owner: staff.governorB.id, p_identity_hmac: banFingerprint, p_days: 7 },
            null,
            true
          )
        ).data.granted,
        true
      );
      assert.equal(await purgeBans(), 1);
      assert.deepEqual((await identityStatus(banFingerprint)).data, {
        banned: false,
        trial_used: true,
      });
      assert.equal(
        sql(
          "select bool_and(not has_table_privilege(r,'private.banned_identities','select,insert,update,delete,truncate,references,trigger')) from unnest(array['anon','authenticated','service_role']) r;"
        ),
        "t"
      );
      record("native-identity-ban-fingerprint-kept-5-years-and-blocks-trials");
    }
    await testTrustedIdentity({
      rpc,
      foundationConnection: {
        url: status.API_URL,
        expectedProjectRef: "local-foundation",
        publishableKey: status.PUBLISHABLE_KEY,
      },
      sql,
      sqlFails,
      record,
      staff,
      controlledSql,
      awaitQueuedRpc,
      stage: (value) => {
        nativeStage = value;
      },
      createUser: createTrackedUser,
    });
    await testPublicNegotiable({
      verificationFixture,
      controlledSql,
      awaitQueuedRpc,
      rpc,
      sql,
      sqlFails,
      record,
      staff,
      connection: {
        url: status.API_URL,
        expectedProjectRef: "local-foundation",
        publishableKey: status.PUBLISHABLE_KEY,
      },
      stage: (value) => {
        nativeStage = value;
      },
      createUser: createTrackedUser,
      deleteTrackedUser: async (id) => {
        const index = users.findIndex((user) => user.id === id);
        assert.ok(index >= 0);
        assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
        users.splice(index, 1);
      },
      createReviewer: async () => {
        nativeStage = "negotiable real reviewer TOTP setup";
        const reviewer = await createTrackedUser("negotiable-reviewer");
        const factor = await reviewer.member.auth.mfa.enroll({ factorType: "totp" });
        assert.equal(factor.error, null);
        const challenge = await reviewer.member.auth.mfa.challenge({ factorId: factor.data.id });
        assert.equal(challenge.error, null);
        const verified = await reviewer.member.auth.mfa.verify({
          factorId: factor.data.id,
          challengeId: challenge.data.id,
          code: totp(factor.data.totp.secret),
        });
        assert.equal(verified.error, null);
        reviewer.token = (await reviewer.member.auth.getSession()).data.session.access_token;
        sql(
          `insert into private.staff_roles(user_id,role,granted_by) values('${reviewer.id}','governor','${staff.admin.id}');`
        );
        return reviewer;
      },
    });
    await testPublicationVerificationReadiness({
      connection: {
        url: status.API_URL,
        expectedProjectRef: "local-foundation",
        publishableKey: status.PUBLISHABLE_KEY,
      },
      rpc,
      sql,
      record,
      createUser: createTrackedUser,
      fixtureAdminId: staff.admin.id,
      controlledSql,
      awaitQueuedRpc,
      stage: (value) => {
        nativeStage = value;
      },
    });
    const types = cli(["gen", "types", "--local", "--schema", "api"]);
    assert.ok(types.includes("rename_transport_resource"));
    assert.ok(types.includes("enqueue_transport_reconciliation"));
    assert.equal(types.includes("private_note"), false);
    assert.ok(types.includes("search_posts") && types.includes("reference_catalog"));
    assert.ok(types.includes("activate_post") && types.includes("apply_provider_event"));
    assert.ok(types.includes("staff_evidence_metadata"));
    assert.ok(types.includes("submit_post") && types.includes("moderate_post"));
    const formattedTypes = execFileSync(
      process.execPath,
      [
        "node_modules/prettier/bin/prettier.cjs",
        "--stdin-filepath",
        "docs/backend-foundation/prototypes/native-api-types.ts",
      ],
      { input: types, encoding: "utf8", env, stdio: ["pipe", "pipe", "pipe"] }
    );
    writeFileSync("docs/backend-foundation/prototypes/native-api-types.ts", formattedTypes);
    record("generated-custom-schema-types");
  } catch (error) {
    // Only fixed scalar assertion diagnostics, never response/error objects,
    // request bodies, token material or arbitrary assertion messages.
    const scalar = (value) =>
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 600) ||
      ["0", "1", "t", "f"].includes(value)
        ? value
        : "redacted";
    const diagnostic =
      error?.code === "ERR_ASSERTION"
        ? {
            actual: scalar(error.actual),
            expected: scalar(error.expected),
            operator: ["strictEqual", "deepStrictEqual", "rejects", "match", "=="].includes(
              error.operator
            )
              ? error.operator
              : "redacted",
          }
        : undefined;
    checks.push({
      id: "next-native-check",
      status: "FAIL",
      reason: `Assertion or local operation failed at ${nativeStage}; prior check IDs delimit the failure`,
      ...(diagnostic ? { diagnostic } : {}),
    });
    process.stderr.write(
      "Native fixture failed after the recorded checks; credentials and responses withheld.\n"
    );
    exitCode = 1;
  } finally {
    try {
      sql(
        `delete from private.transport_jobs where id='${job}'; delete from private.transport_resources where id='${resource}';` +
          (users.length
            ? ((ids) =>
                `delete from private.identity_ban_proposal_requests where owner_id in (${ids});` +
                `delete from private.identity_ban_bindings where decision_id in(select d.id from private.decisions d join private.evidence_cases c on c.id=d.case_id where c.subject_id in (${ids}));` +
                `delete from private.identity_review_proposals where submission_id in(select id from private.verification_identity_submissions where owner_id in (${ids}));` +
                `delete from private.accepted_identity_facts where owner_id in (${ids});` +
                `delete from private.verification_current_submissions where case_id in(select id from private.evidence_cases where subject_id in (${ids}));` +
                `delete from private.verification_identity_submissions where owner_id in (${ids});` +
                `delete from private.verification_phone_proofs where owner_id in (${ids});` +
                `delete from private.verification_phone_challenges where owner_id in (${ids});` +
                `delete from private.verification_localities where owner_id in (${ids});` +
                `alter table private.evidence_access_log disable trigger evidence_access_log_append_only;` +
                `delete from private.evidence_access_log where staff_id in (${ids});` +
                `alter table private.evidence_access_log enable trigger evidence_access_log_append_only;` +
                `delete from private.banned_identities where decision_id in (select id from private.decisions where proposed_by in (${ids}) or approved_by in (${ids}));` +
                `delete from private.cost_alarms where acknowledged_by in (${ids}) or acknowledged_by is null;` +
                `alter table private.decisions disable trigger decision_binding;` +
                `delete from private.decisions where proposed_by in (${ids}) or approved_by in (${ids});` +
                `alter table private.decisions enable trigger decision_binding;` +
                `delete from private.legal_holds where subject_id in (${ids}) or placed_by in (${ids});` +
                `delete from private.evidence_artifacts where owner_id in (${ids});` +
                `delete from private.account_closures where user_id in (${ids});` +
                `delete from private.evidence_cases where subject_id in (${ids});` +
                `delete from private.staff_roles where user_id in (${ids});` +
                `delete from private.provider_events where merchant_reference='bf07-unknown' or payment_id in (select id from private.payments where owner_id in (${ids}));` +
                `delete from private.invoices where payment_id in (select id from private.payments where owner_id in (${ids}));` +
                `delete from private.post_addon_windows where payment_id in (select id from private.payments where owner_id in (${ids}));` +
                `delete from private.post_trial_claims where owner_id in (${ids});` +
                `delete from private.post_activations where owner_id in (${ids});` +
                `delete from private.trial_identities where owner_id in (${ids}) or owner_id is null;` +
                `delete from private.entitlements where owner_id in (${ids});` +
                `delete from private.outbox_events where owner_id in (${ids});` +
                `delete from private.payments where owner_id in (${ids});` +
                `alter table private.queue_claim_events disable trigger queue_claim_events_append_only;` +
                `delete from private.queue_claim_events where actor_id in (${ids}) or from_staff in (${ids}) or to_staff in (${ids});` +
                `alter table private.queue_claim_events enable trigger queue_claim_events_append_only;` +
                `delete from private.queue_claims where claimed_by in (${ids}) or post_id in (select id from private.posts where owner_id in (${ids})) or report_id in (select id from private.reports where subject_account_id in (${ids}) or reporter_id in (${ids}));` +
                `delete from private.reports where subject_account_id in (${ids}) or reporter_id in (${ids}) or resolved_by in (${ids});` +
                `alter table private.moderation_log disable trigger moderation_log_append_only;` +
                `delete from private.moderation_log where staff_id in (${ids}) or post_id in (select id from private.posts where owner_id in (${ids}));` +
                `alter table private.moderation_log enable trigger moderation_log_append_only;` +
                `delete from private.posts where owner_id in (${ids});` +
                `delete from private.media_objects where owner_id in (${ids});`)(
                users.map((user) => `'${uuid(user.id)}'`).join(",")
              )
            : "")
      );
    } catch {
      checks.push({ id: "synthetic-sql-cleanup", status: "INCOMPLETE" });
      exitCode = 1;
    }
    for (const user of users) {
      try {
        const result = await admin.auth.admin.deleteUser(user.id);
        if (result.error) throw new Error("cleanup incomplete");
      } catch {
        checks.push({ id: "synthetic-auth-cleanup", status: "INCOMPLETE" });
        exitCode = 1;
      }
    }
    if (Object.entries(provenance).some(([file, hash]) => digest(file) !== hash)) {
      checks.push({ id: "immutable-run-provenance", status: "FAIL" });
      exitCode = 1;
    }
    try {
      release();
      checks.push({ id: "fixture-operation-lock-release", status: "PASS" });
    } catch {
      checks.push({ id: "fixture-operation-lock-release", status: "INCOMPLETE" });
      exitCode = 1;
    }
    const dir = `docs/backend-foundation/evidence/native-${startedAt.replaceAll(":", "-")}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/results.json`,
      JSON.stringify(
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          engine: "Native PostgreSQL 17 + PostgREST + local GoTrue",
          fixtureProject: config.project_id,
          referenceSqlHash: provenance["docs/backend-foundation/prototypes/transport.sql"],
          provenance,
          appliedFunctions,
          checks,
          status: exitCode ? "FAIL" : "PASS",
          releaseReady: false,
          productionMutations: [],
          incomplete: [
            "Full BF-03 field contracts",
            "Staff/AAL2/governance/payment/evidence matrix",
            "Revocation-write race semantics",
            "Hosted configuration",
            "Region measurements",
            "BF-12",
            "BF-28",
            "Recovery",
          ],
        },
        null,
        2
      ) + "\n"
    );
    process.stdout.write(`Redacted native results: ${dir}/results.json\n`);
  }
  process.exitCode = exitCode;
}
try {
  await run();
} catch {
  process.stderr.write(
    "Native fixture setup or recording failed; CLI output, credentials and SDK errors withheld.\n"
  );
  process.exitCode = 1;
}
