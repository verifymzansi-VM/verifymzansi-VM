import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import { readFoundationVerificationReadiness } from "../../src/lib/foundation/verification-readiness.ts";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  attachFixtureCover,
  createPostingVerifier,
  createTrustedPostingFixture,
} from "./foundation-trusted-posting-fixture.mjs";
import { captureFoundationFinancialState } from "./foundation-financial-snapshot.mjs";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };

/** Actual Auth/HTTP + canonical
 * verification review; scanner/phone delivery remain synthetic metadata. */
export async function testPublicationVerificationReadiness({
  createUser,
  connection,
  fixtureAdminId,
  rpc,
  sql,
  stage,
  record,
  controlledSql,
  awaitQueuedRpc,
}) {
  stage("publication readiness genuine reviewer and owners");
  const reviewer = await createPostingVerifier({ createUser, sql, fixtureAdminId });
  const fixture = createTrustedPostingFixture({ rpc, sql, reviewer });
  const owner = await createUser("readiness-owner");
  const prefix = "readiness" + randomBytes(4).toString("hex");
  let serial = 0;
  const call = async (name, body, user = owner, service = false) => {
    const response = await rpc(name, body, user?.token ?? null, service);
    assert.equal(response.status, 200, "readiness fixture " + name);
    return response.data;
  };
  const observe = (user = owner) =>
    readFoundationVerificationReadiness(createFoundationAuthenticatedApi(connection, user.token));
  const expected = (ready, phone, locality) => ({
    verification_ready: ready,
    phone_verified: phone,
    locality_confirmed: locality,
  });
  const snapshot = () => {
    const tables = [
      "posts",
      "listing_details",
      "business_details",
      "event_details",
      "post_contacts",
      "post_media",
      "post_search_documents",
      "queue_claims",
      "moderation_log",
    ];
    return (
      sql(
        "select encode(sha256(convert_to(jsonb_build_object(" +
          tables
            .map(
              (t) =>
                "'" +
                t +
                "',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from private." +
                t +
                " x)"
            )
            .join(",") +
          ")::text,'UTF8')),'hex');"
      ) +
      ":" +
      captureFoundationFinancialState(sql)
    );
  };
  const make = async (user = owner, kind = "event", channels = ["form"]) => {
    const event = kind === "event",
      listing = kind === "listing";
    let post = await call(
      "create_core_draft",
      {
        p_kind: kind,
        p_area: listing ? "market" : event ? "tourism_events" : "business",
        p_category_key: listing ? "jobs_services" : event ? "events" : "automotive_services",
        ...(event
          ? { p_activity_key: reference.activities.find((a) => a.category === "events").key }
          : {}),
        p_detail: {
          ...(kind !== "business" ? { contact_channels: channels } : {}),
          ...(event
            ? {
                starts_at: new Date(Date.now() - 60000).toISOString(),
                ends_at: new Date(Date.now() + 7200000).toISOString(),
                timezone: "Africa/Johannesburg",
              }
            : {}),
        },
      },
      user
    );
    if (listing) {
      post = await call(
        "save_core_listing_terms",
        {
          p_id: post.id,
          p_expected_revision: post.revision,
          p_terms: { price: { mode: "on_request" }, negotiable: false },
        },
        user
      );
      post = await call(
        "save_listing_attributes",
        {
          p_post_id: post.id,
          p_expected_revision: post.revision,
          p_attributes: { job_type: "full_time", location_type: "remote" },
        },
        user
      );
    }
    post = await call(
      "save_post_content",
      {
        p_post_id: post.id,
        p_expected_revision: post.revision,
        p_content: {
          title: prefix + " " + ++serial,
          description: "Synthetic local verification publication rehearsal.",
          province_id: "gp",
          city_id: "gp_johannesburg",
        },
      },
      user
    );
    if (event) post = await attachFixtureCover(call, post, user);
    return post;
  };
  const submit = (post, user = owner) =>
    rpc("submit_post", { p_post_id: post.id, p_expected_revision: post.revision }, user.token);
  const denied = async (
    operation,
    detail = "posting_verification_required",
    code = "42501",
    status = 403
  ) => {
    const before = snapshot();
    const response = await operation();
    assert.equal(response.status, status);
    assert.equal(response.data.code, code);
    assert.equal(response.data.details, detail);
    assert.equal(
      snapshot(),
      before,
      "Denied operation must roll back complete publication/finance state"
    );
  };
  const claim = async (post) => {
    await reviewer.refresh();
    return call("claim_queue_item", { p_subject: "post", p_id: post.id }, reviewer);
  };
  const decide = (post, lease, decision = "approve") =>
    rpc(
      "moderate_post",
      {
        p_post_id: post.id,
        p_expected_revision: post.revision,
        p_decision: decision,
        p_reason: decision === "reject" ? "Synthetic verification correction requested" : null,
        p_claim_generation: lease.claim_generation,
        p_claim_nonce: lease.claim_nonce,
      },
      reviewer.token
    );

  stage("publication readiness DTO and authority boundaries");
  assert.deepEqual(await observe(), expected(false, false, false));
  for (const service of [false, true]) {
    const result = await rpc("get_owner_verification_readiness", {}, null, service);
    assert.equal(result.status, service ? 403 : 401);
    assert.equal(result.data.code, "42501");
  }
  assert.equal(
    (await rpc("get_owner_verification_readiness", { p_owner: fixtureAdminId }, owner.token))
      .status,
    404
  );
  record("native-readiness-current-owner-only-three-booleans-anon-service-actor-injection-denied");

  stage("publication readiness private preparation remains usable");
  const drafts = [];
  for (const kind of ["listing", "business", "event"]) {
    const post = await make(owner, kind);
    drafts.push(post);
    await denied(() => submit(post));
  }
  record("native-readiness-unverified-listing-business-event-submit-denied-private-drafts-usable");

  stage("publication readiness canonical incomplete combinations");
  await fixture.identity(owner);
  assert.deepEqual(await observe(), expected(false, false, false));
  await denied(() => submit(drafts[2]));
  await fixture.phone(owner);
  assert.deepEqual(await observe(), expected(false, true, false));
  await denied(() => submit(drafts[2]));
  const phoneOnly = await createUser("readiness-phone-only");
  await fixture.phone(phoneOnly);
  await fixture.locality(phoneOnly);
  assert.deepEqual(await observe(phoneOnly), expected(false, true, true));
  await fixture.locality(owner);
  assert.deepEqual(await observe(), expected(true, true, true));
  record("native-readiness-identity-only-and-missing-locality-and-phone-locality-only-denied");

  stage("publication readiness genuine positive publication and independent approval");
  const submitted = await call("submit_post", {
    p_post_id: drafts[2].id,
    p_expected_revision: drafts[2].revision,
  });
  const lease = await claim(submitted);
  const approved = await decide(submitted, lease);
  assert.equal(approved.status, 200);
  assert.equal(sql("select status from private.posts where id='" + submitted.id + "';"), "live");
  assert.equal(
    sql("select count(*) from private.post_search_documents where post_id='" + submitted.id + "';"),
    "1"
  );
  record("native-readiness-complete-canonical-event-submit-and-independent-approval");

  stage("publication readiness proof revocation blocks approval but rejection remains usable");
  const revoked = await createUser("readiness-revoked");
  const accepted = await fixture.ready(revoked);
  const pending = await make(revoked);
  const pendingAck = await call(
    "submit_post",
    { p_post_id: pending.id, p_expected_revision: pending.revision },
    revoked
  );
  const pendingLease = await claim(pendingAck);
  sql(
    "update private.accepted_identity_facts set revoked_at=clock_timestamp() where id='" +
      accepted.factId +
      "';"
  );
  assert.deepEqual(await observe(revoked), expected(false, true, true));
  await denied(() => decide(pendingAck, pendingLease));
  assert.equal((await decide(pendingAck, pendingLease, "reject")).status, 200);
  record(
    "native-readiness-revoked-identity-blocks-approval-atomic-claim-log-rollback-rejection-allowed"
  );

  const adverse = [
    [
      "stale-version",
      (ready) =>
        "update private.evidence_cases set version=version+1 where id='" + ready.caseId + "';",
    ],
  ];
  for (const [label, mutate] of adverse) {
    stage("publication readiness " + label);
    const user = await createUser("readiness-" + label),
      ready = await fixture.ready(user),
      post = await make(user);
    sql(mutate(ready));
    assert.deepEqual(await observe(user), expected(false, true, true));
    await denied(() => submit(post, user));
    record("native-readiness-" + label + "-blocks-submit-without-publication-or-financial-change");
  }
  // DEC-35: files of a decided case are deleted after 30 days; the reviewed
  // decision, not the stored bytes, keeps the account verified.
  const retired = [
    [
      "expired-artifact",
      (ready) =>
        "update private.evidence_artifacts set retain_until=clock_timestamp()-interval '1 second' where case_id='" +
        ready.caseId +
        "';",
    ],
    [
      "retired-artifact",
      (ready) =>
        "update private.evidence_artifacts set state='cleanup_required' where case_id='" +
        ready.caseId +
        "';",
    ],
  ];
  for (const [label, mutate] of retired) {
    stage("publication readiness " + label);
    const user = await createUser("readiness-" + label),
      ready = await fixture.ready(user);
    sql(mutate(ready));
    assert.deepEqual(await observe(user), expected(true, true, true));
    record("native-readiness-" + label + "-after-decision-keeps-verification");
  }

  if (controlledSql) {
    for (const label of [
      "phone-revoked",
      "locality-removed",
      "identity-revoked",
      "caller-expired",
    ]) {
      stage("publication readiness confirmed queued submit " + label);
      const user = await createUser("readiness-wait-" + label),
        ready = await fixture.ready(user),
        post = await make(user);
      const session = JSON.parse(Buffer.from(user.token.split(".")[1], "base64url")).session_id;
      assert.match(session, /^[a-f0-9-]{36}$/);
      const mutation =
        label === "phone-revoked"
          ? "update private.verification_phone_proofs set revoked_at=clock_timestamp() where id='" +
            ready.proofId +
            "';"
          : label === "locality-removed"
            ? "delete from private.verification_localities where owner_id='" + user.id + "';"
            : label === "identity-revoked"
              ? "update private.accepted_identity_facts set revoked_at=clock_timestamp() where id='" +
                ready.factId +
                "';"
              : "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" +
                session +
                "';";
      const before = snapshot();
      const blocker = controlledSql(
        "begin;select id from private.posts where id='" +
          post.id +
          "' for update;select 'EVIDENCE_LOCK_HELD';select pg_sleep(4);" +
          mutation +
          "commit;"
      );
      let pending;
      try {
        await blocker.barrier;
        pending = submit(post, user).then(
          (value) => ({ value }),
          (error) => ({ error })
        );
        await awaitQueuedRpc("submit_post");
        assert.equal(await blocker.done, 0);
        const settled = await pending;
        if (settled.error) throw settled.error;
        assert.equal(settled.value.status, 403);
        assert.equal(settled.value.data.code, "42501");
        if (label !== "caller-expired")
          assert.equal(settled.value.data.details, "posting_verification_required");
        assert.equal(snapshot(), before);
      } finally {
        if (pending) await pending;
        await blocker.done;
        blocker.close();
      }
      record("native-readiness-confirmed-post-lock-wait-" + label + "-submit-atomic-denial");
    }
  }
  stage("publication readiness contact-specific precedence and live getter denial");
  const noPhone = await createUser("readiness-no-phone");
  await fixture.identity(noPhone);
  await fixture.locality(noPhone);
  const phoneContact = await make(noPhone, "event", ["call"]);
  await denied(() => submit(phoneContact, noPhone), "contact_phone_required", "PT409", 409);
  const formContact = await make(noPhone);
  await denied(() => submit(formContact, noPhone));
  const noPhoneSession = JSON.parse(
    Buffer.from(noPhone.token.split(".")[1], "base64url")
  ).session_id;
  assert.match(noPhoneSession, /^[a-f0-9-]{36}$/);
  sql(
    "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" +
      noPhoneSession +
      "';"
  );
  assert.equal((await rpc("get_owner_verification_readiness", {}, noPhone.token)).status, 403);
  sql(
    "update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='" +
      phoneOnly.id +
      "';"
  );
  assert.equal((await rpc("get_owner_verification_readiness", {}, phoneOnly.token)).status, 403);
  record(
    "native-readiness-contact-phone-specific-conflict-before-global-refusal-expired-restricted-getter-denied"
  );

  if (controlledSql) {
    for (const mode of [
      "quota",
      "edit-media",
      "edit-projection",
      "ordinary-projection",
      "combined-projection",
    ]) {
      stage("publication readiness final guard " + mode);
      const user = await createUser("readiness-final-" + mode),
        ready = await fixture.ready(user);
      let post = await make(user),
        operation,
        name = "moderate_post",
        lock;
      if (mode === "quota") {
        name = "submit_post";
        operation = () => submit(post, user);
        lock = "select pg_advisory_xact_lock(hashtextextended('" + user.id + "',909));";
      } else {
        let ack = await call(
          "submit_post",
          { p_post_id: post.id, p_expected_revision: post.revision },
          user
        );
        let lease = await claim(ack);
        assert.equal((await decide(ack, lease)).status, 200);
        post = {
          id: post.id,
          revision: Number(sql("select revision from private.posts where id='" + post.id + "';")),
        };
        if (mode === "ordinary-projection") {
          post = await call(
            "set_post_state",
            { p_post_id: post.id, p_expected_revision: post.revision, p_action: "pause" },
            user
          );
        } else {
          post = await call(
            "create_post_edit",
            { p_post_id: post.id, p_expected_revision: post.revision },
            user
          );
          post = await call(
            "save_post_content",
            {
              p_post_id: post.id,
              p_expected_revision: post.revision,
              p_content: {
                title: prefix + " changed " + ++serial,
                description: "Synthetic revised event publication readiness.",
                province_id: "gp",
                city_id: "gp_johannesburg",
              },
            },
            user
          );
        }
        ack = await call(
          "submit_post",
          { p_post_id: post.id, p_expected_revision: post.revision },
          user
        );
        lease = await claim(ack);
        operation = () => decide(ack, lease);
        if (mode === "edit-media")
          lock =
            "select id from private.media_objects where id in(select object_id from private.post_media where post_id='" +
            post.id +
            "') for update;";
        else {
          const original = sql(
            "select coalesce(edit_of,id)::text from private.posts where id='" + post.id + "';"
          );
          assert.match(original, /^[a-f0-9-]{36}$/);
          lock =
            "select post_id from private.post_search_documents where post_id='" +
            original +
            "' for update;";
        }
      }
      const before = snapshot(),
        blocker = controlledSql(
          "begin;" + lock + "select 'EVIDENCE_LOCK_HELD';select pg_sleep(5);commit;"
        );
      let pending;
      try {
        await blocker.barrier;
        pending = operation().then(
          (value) => ({ value }),
          (error) => ({ error })
        );
        await awaitQueuedRpc(name);
        sql(
          "update private.accepted_identity_facts set revoked_at=clock_timestamp() where id='" +
            ready.factId +
            "';"
        );
        if (mode === "combined-projection") {
          const session = JSON.parse(
            Buffer.from(reviewer.token.split(".")[1], "base64url")
          ).session_id;
          assert.match(session, /^[a-f0-9-]{36}$/);
          sql(
            "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" +
              session +
              "';"
          );
        }
        assert.equal(await blocker.done, 0);
        const settled = await pending;
        if (settled.error) throw settled.error;
        assert.equal(settled.value.status, 403);
        assert.equal(settled.value.data.code, "42501");
        if (mode === "combined-projection")
          assert.notEqual(
            settled.value.data.details,
            "posting_verification_required",
            "Expired caller must take precedence over readiness diagnosis"
          );
        else assert.equal(settled.value.data.details, "posting_verification_required");
        assert.equal(
          snapshot(),
          before,
          "Final guard must restore original/copy/contacts/projection/claim/log and all finances"
        );
      } finally {
        if (pending) await pending;
        await blocker.done;
        blocker.close();
      }
      record("native-readiness-final-" + mode + "-wait-canonical-loss-exact-atomic-rollback");
    }
  }
}
