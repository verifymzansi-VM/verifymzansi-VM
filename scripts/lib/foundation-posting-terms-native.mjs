import assert from "node:assert/strict";
import {
  FIXTURE_POSTING_TERMS as current,
  NEXT_FIXTURE_POSTING_TERMS as next,
  acceptFixturePostingTerms,
} from "./foundation-posting-terms-fixture.mjs";
import { captureFoundationFinancialState } from "./foundation-financial-snapshot.mjs";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import { createFoundationPublicApi } from "../../src/lib/foundation/public-api.ts";
import {
  readFoundationPostingTerms,
  readFoundationOwnerPostingTerms,
  acceptFoundationPostingTerms,
} from "../../src/lib/foundation/posting-terms.ts";

export async function testPostingTerms({
  createUser,
  rpc,
  sql,
  sqlFails,
  verificationFixture,
  controlledSql,
  awaitQueuedRpc,
  record,
  connection,
}) {
  const owner = await createUser("terms-owner", { postingTerms: false });
  const other = await createUser("terms-other", { postingTerms: false });
  const command = (document = current) => ({
    p_version: document.version,
    p_document_hash: document.document_hash,
  });
  const call = async (name, body, user = owner, service = false) => {
    const result = await rpc(name, body, user?.token ?? null, service);
    assert.equal(result.status, 200, "posting terms fixture " + name);
    return result.data;
  };
  const ledger = () => sql("select count(*) from private.posting_terms_acceptances;");
  const typed = (user) => createFoundationAuthenticatedApi(connection, user.token);
  const observe = (user = owner) => readFoundationOwnerPostingTerms(typed(user));
  assert.deepEqual(await readFoundationPostingTerms(createFoundationPublicApi(connection)), {
    ...current,
    document_path: "/terms/versions/" + current.version,
  });
  assert.equal((await observe()).accepted_at, null);
  assert.equal((await observe(other)).accepted_at, null);
  for (const service of [false, true])
    assert.ok(
      [401, 403].includes((await rpc("accept_posting_terms", command(), null, service)).status)
    );
  assert.notEqual(
    (await rpc("accept_posting_terms", { ...command(), p_owner: other.id }, owner.token)).status,
    200
  );
  record("native-posting-terms-public-document-private-caller-and-injection-denials");

  await verificationFixture.ready(owner);
  await call("grant_verified_intro_trial", { p_owner: owner.id, p_days: 7 }, null, true);
  let post = await call("create_core_draft", {
    p_kind: "listing",
    p_area: "market",
    p_category_key: "jobs_services",
    p_detail: { contact_channels: ["form"] },
  });
  post = await call("save_core_listing_terms", {
    p_id: post.id,
    p_expected_revision: post.revision,
    p_terms: { price: { mode: "on_request" }, negotiable: false },
  });
  post = await call("save_listing_attributes", {
    p_post_id: post.id,
    p_expected_revision: post.revision,
    p_attributes: { job_type: "full_time", location_type: "remote" },
  });
  post = await call("save_post_content", {
    p_post_id: post.id,
    p_expected_revision: post.revision,
    p_content: {
      title: "Synthetic terms posting check",
      description: "Synthetic local posting terms acceptance verification.",
      province_id: "gp",
      city_id: "gp_johannesburg",
    },
  });
  const submit = () =>
    rpc("submit_post", { p_post_id: post.id, p_expected_revision: post.revision }, owner.token);
  const snapshot = () =>
    captureFoundationFinancialState(sql) +
    ":" +
    sql(
      "select encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from private.posts p where id='" +
        post.id +
        "';"
    );
  const assertDenied = async (status, detail) => {
    const before = snapshot();
    const result = await submit();
    assert.equal(result.status, status);
    assert.equal(result.data.details, detail);
    assert.equal(snapshot(), before, "Terms refusal must roll back posting and financial writes");
  };
  const beforeLedger = ledger();
  await assertDenied(409, "posting_terms_required");
  assert.equal(ledger(), beforeLedger);
  record("native-posting-terms-direct-submit-missing-consent-rolls-back-activation");

  sql("delete from private.posting_terms_current;");
  try {
    assert.equal(await call("get_current_posting_terms", {}, null), null);
    assert.equal((await rpc("accept_posting_terms", command(), owner.token)).status, 503);
    await assertDenied(503, "posting_terms_unavailable");
  } finally {
    sql("insert into private.posting_terms_current(version) values('" + current.version + "');");
  }
  record("native-posting-terms-unpublished-policy-fails-closed");

  const accepted = await Promise.all(
    [1, 2].map(() => acceptFoundationPostingTerms(typed(owner), { ...current, accepted: true }))
  );
  assert.equal(accepted[0].accepted_at, accepted[1].accepted_at);
  assert.equal((await observe()).accepted_at, accepted[0].accepted_at);
  assert.equal((await observe(other)).accepted_at, null);
  assert.equal(
    sql(
      "select count(*) from private.posting_terms_acceptances where owner_id='" + owner.id + "';"
    ),
    "1"
  );
  sqlFails(
    "update private.posting_terms_acceptances set accepted_at=clock_timestamp() where owner_id='" +
      owner.id +
      "';",
    "23514"
  );
  sqlFails(
    "update private.posting_terms_versions set document_hash='" +
      next.document_hash +
      "' where version='" +
      current.version +
      "';",
    "23514"
  );
  const submitted = await submit();
  assert.equal(submitted.status, 200);
  post = submitted.data;
  record("native-posting-terms-real-caller-once-per-version-idempotent-and-immutable");

  sql(
    "insert into private.posting_terms_versions(version,document_hash) values('" +
      next.version +
      "','" +
      next.document_hash +
      "');"
  );
  try {
    sql("update private.posting_terms_current set version='" + next.version + "';");
    assert.equal((await observe()).accepted_at, null);
    assert.equal(
      sql("select status from private.posts where id='" + post.id + "';"),
      "pending_moderation"
    );
    // Negative resubmission fixture retains the genuinely acquired activation.
    sql("update private.posts set status='rejected' where id='" + post.id + "';");
    await assertDenied(409, "posting_terms_required");
    const before = ledger();
    assert.equal((await rpc("accept_posting_terms", command(), owner.token)).status, 409);
    assert.equal(ledger(), before);
    await acceptFixturePostingTerms(owner.member, next);
    assert.equal((await submit()).status, 200);
    record("native-posting-terms-new-version-requires-new-consent-before-resubmission");
  } finally {
    sql("update private.posting_terms_current set version='" + current.version + "';");
  }

  if (controlledSql)
    for (const mutation of ["policy", "session"]) {
      const user = await createUser("terms-wait-" + mutation, { postingTerms: false });
      const sessionId = JSON.parse(Buffer.from(user.token.split(".")[1], "base64url")).session_id;
      assert.match(sessionId, /^[a-f0-9-]{36}$/);
      const prior = sql(
        "select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='" +
          sessionId +
          "';"
      );
      const blocker = controlledSql(
        "begin; set local idle_in_transaction_session_timeout='30s'; " +
          (mutation === "policy"
            ? "update private.posting_terms_current set version='" + next.version + "';"
            : "select singleton from private.posting_terms_current for update;") +
          "select 'EVIDENCE_LOCK_HELD:'||pg_backend_pid();",
        { hold: true }
      );
      let pending;
      try {
        await blocker.barrier;
        pending = rpc("accept_posting_terms", command(), user.token).then(
          (value) => ({ value }),
          () => ({ failed: true })
        );
        await awaitQueuedRpc("accept_posting_terms");
        assert.ok(
          Number(
            sql(
              "select count(*) from pg_stat_activity where datname='postgres' and wait_event_type='Lock' and query like '%accept_posting_terms%' and " +
                blocker.backendPid +
                "=any(pg_blocking_pids(pid));"
            )
          ) > 0
        );
        if (mutation === "session")
          sql(
            "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" +
              sessionId +
              "';"
          );
        blocker.release();
        assert.equal(await blocker.done, 0);
        const result = (await pending).value;
        assert.equal(result.status, mutation === "policy" ? 409 : 403);
        assert.equal(
          sql(
            "select count(*) from private.posting_terms_acceptances where owner_id='" +
              user.id +
              "';"
          ),
          "0"
        );
      } finally {
        blocker.close();
        await blocker.done;
        await pending;
        sql(
          "update auth.sessions set not_after=" +
            prior +
            " where id='" +
            sessionId +
            "'; update private.posting_terms_current set version='" +
            current.version +
            "';"
        );
      }
      record("native-posting-terms-confirmed-wait-" + mutation + "-change-denies-acceptance");
    }
  assert.equal(
    sql(
      "select bool_and(not has_table_privilege(r,t,'select,insert,update,delete') and not has_any_column_privilege(r,t,'select,insert,update')) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private.posting_terms_versions','private.posting_terms_current','private.posting_terms_acceptances']) t;"
    ),
    "t"
  );
  record("native-posting-terms-no-browser-or-service-base-table-access");
}
