import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import { createFoundationPostDraft } from "../../src/lib/foundation/post-draft.ts";
import {
  readFoundationPostContacts,
  saveFoundationPostContacts,
} from "../../src/lib/foundation/post-contacts.ts";
import { readFoundationPublicPost } from "../../src/lib/foundation/public-post.ts";
import { createFoundationPublicApi } from "../../src/lib/foundation/public-api.ts";
import { submitFoundationPost } from "../../src/lib/foundation/post-submission.ts";
import { captureFoundationFinancialState } from "./foundation-financial-snapshot.mjs";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };

// Real Auth, owner/staff commands and caller-bound SDKs. Scanner/SMS delivery
// are synthetic metadata/provider assertions; privileged revocation is labelled.
export async function testPostContactPreferences({
  createUser,
  verificationFixture,
  createReviewer,
  fixtureAdminId,
  connection,
  rpc,
  sql,
  record,
  stage,
  controlledSql,
  awaitQueuedRpc,
}) {
  const owner = await createUser("contact-owner"),
    other = await createUser("contact-other"),
    reviewer = await createReviewer(),
    prefix = "contacts" + randomBytes(4).toString("hex"),
    api = createFoundationAuthenticatedApi(connection, owner.token),
    foreign = createFoundationAuthenticatedApi(connection, other.token),
    publicApi = createFoundationPublicApi(connection),
    activity = reference.activities.find((row) => row.category === "events").key;
  await verificationFixture.identity(owner);
  await verificationFixture.locality(owner);
  let serial = 0;
  const settle = (promise) =>
    promise.then(
      (value) => ({ value }),
      (error) => ({ error })
    );
  const complete = async (promise) => {
    const settled = await promise;
    if (settled.error) throw settled.error;
    return settled.value;
  };
  const call = async (name, body, token = owner.token, service = false) => {
    const r = await rpc(name, body, service ? null : token, service);
    assert.equal(r.status, 200, "contact fixture " + name);
    return r.data;
  };
  const read = (id) => readFoundationPostContacts(api, { id });
  const save = (id, revision, channels) =>
    saveFoundationPostContacts(api, { id, expected_revision: revision, channels });
  const financial = () => JSON.stringify(captureFoundationFinancialState(sql));
  const state = (id) =>
    sql(
      "select jsonb_build_object('post',to_jsonb(p),'contacts',(select to_jsonb(c) from private.post_contacts c where c.post_id=p.id),'copies',(select jsonb_agg(to_jsonb(e) order by e.id) from private.posts e where e.edit_of=p.id),'copyContacts',(select jsonb_agg(to_jsonb(c) order by c.post_id) from private.post_contacts c join private.posts e on e.id=c.post_id where e.edit_of=p.id),'claims',(select jsonb_agg(to_jsonb(q) order by q.id) from private.queue_claims q where q.post_id=p.id or q.post_id in(select id from private.posts e where e.edit_of=p.id)),'log',(select jsonb_agg(to_jsonb(l) order by l.id) from private.moderation_log l where l.post_id=p.id)) from private.posts p where p.id='" +
        id +
        "';"
    );
  const claim = (p) => call("claim_queue_item", { p_subject: "post", p_id: p.id }, reviewer.token);
  const moderation = (p, lease, decision = "approve") =>
    rpc(
      "moderate_post",
      {
        p_post_id: p.id,
        p_expected_revision: p.revision,
        p_decision: decision,
        p_reason: decision === "reject" ? "Synthetic contact correction requested" : null,
        p_claim_generation: lease.claim_generation,
        p_claim_nonce: lease.claim_nonce,
      },
      reviewer.token
    );
  const decide = async (p, decision = "approve") => {
    const lease = await claim(p),
      r = await moderation(p, lease, decision);
    assert.equal(r.status, 200, "contact moderation " + decision);
    return r.data;
  };
  const submit = (p) => submitFoundationPost(api, { id: p.id, expected_revision: p.revision });
  const current = async (id) => ({ id, revision: (await read(id)).revision });
  stage("contacts explicit private preparation");
  sql(
    "insert into private.entitlements(owner_id,source,area,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at) values('" +
      owner.id +
      "','staff_grant','market','" +
      fixtureAdminId +
      "',5,10,1,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '7 days');"
  );
  const image = await call("begin_media_upload", { p_kind: "image", p_bytes: 128 });
  await call(
    "finalize_media",
    {
      p_object_id: image.object_id,
      p_size: 128,
      p_sha256: createHash("sha256").update(prefix).digest("hex"),
      p_mime: "image/jpeg",
      p_width: 800,
      p_height: 600,
    },
    null,
    true
  );
  const make = async (kind = "event", channels = undefined) => {
    const p = await createFoundationPostDraft(api, {
      context:
        kind === "event"
          ? { kind, area: "tourism_events", category_key: "events", activity_key: activity }
          : { kind, area: "market", category_key: "jobs_services" },
      detail: {
        ...(kind === "event"
          ? {
              starts_at: new Date(Date.now() - 60000).toISOString(),
              ends_at: new Date(Date.now() + 7200000).toISOString(),
              timezone: "Africa/Johannesburg",
            }
          : {}),
        ...(channels === undefined ? {} : { contact_channels: channels }),
      },
    });
    let revision = p.revision;
    if (kind === "listing") {
      revision = (
        await call("save_core_listing_terms", {
          p_id: p.id,
          p_expected_revision: revision,
          p_terms: { price: { mode: "on_request" }, negotiable: false },
        })
      ).revision;
      revision = (
        await call("save_listing_attributes", {
          p_post_id: p.id,
          p_expected_revision: revision,
          p_attributes: { job_type: "full_time", location_type: "remote" },
        })
      ).revision;
    }
    revision = (
      await call("save_post_content", {
        p_post_id: p.id,
        p_expected_revision: revision,
        p_content: {
          title: prefix + " post " + ++serial,
          description: "Synthetic private contact preference workflow only.",
          province_id: "gp",
          city_id: "gp_johannesburg",
        },
      })
    ).revision;
    if (kind === "event")
      revision = (
        await call("set_post_media", {
          p_post_id: p.id,
          p_expected_revision: revision,
          p_items: [{ object_id: image.object_id, purpose: "cover", position: 0 }],
        })
      ).revision;
    return { id: p.id, revision, kind };
  };
  const publish = async (p) => {
    const submitted = await submit(p);
    await decide(submitted);
    return current(p.id);
  };
  const beginCopy = (p) =>
    call("create_post_edit", { p_post_id: p.id, p_expected_revision: p.revision });
  const missing = await make();
  assert.equal((await read(missing.id)).channels, null);
  assert.equal((await read(missing.id)).phone_ready, false);
  const financeBefore = financial(),
    before = state(missing.id);
  await assert.rejects(
    () => submit(missing),
    /^Error: Choose at least one contact method before submitting$/
  );
  assert.equal(state(missing.id), before);
  assert.equal(financial(), financeBefore);
  let changed = await save(missing.id, missing.revision, []);
  assert.deepEqual((await read(missing.id)).channels, []);
  await assert.rejects(
    () => submit(changed),
    /^Error: Choose at least one contact method before submitting$/
  );
  changed = await save(missing.id, changed.revision, ["in_app", "form"]);
  assert.deepEqual(changed.channels, ["form"]);
  const initialPhone = await verificationFixture.phone(owner);
  await publish(changed);
  assert.equal(
    Object.hasOwn(await readFoundationPublicPost(publicApi, { id: missing.id }), "channels"),
    false
  );
  record("native-contacts-unset-cleared-and-explicit-form-publication-private-dto");

  stage("contacts exact owner and revision boundaries");
  assert.equal(await readFoundationPostContacts(foreign, { id: missing.id }), null);
  const business = await createFoundationPostDraft(api, {
    context: { kind: "business", area: "business", category_key: "automotive_services" },
    detail: {},
  });
  assert.equal(await read(business.id), null);
  const draft = await make("listing", ["form"]),
    unchanged = state(draft.id);
  for (const [body, token] of [
    [
      { p_post_id: draft.id, p_expected_revision: draft.revision - 1, p_channels: ["call"] },
      owner.token,
    ],
    [
      { p_post_id: draft.id, p_expected_revision: draft.revision, p_channels: ["call"] },
      other.token,
    ],
    [{ p_post_id: business.id, p_expected_revision: 1, p_channels: ["form"] }, owner.token],
  ])
    assert.ok([400, 409].includes((await rpc("set_post_contacts", body, token)).status));
  assert.equal(state(draft.id), unchanged);
  for (const service of [false, true]) {
    const r = await rpc(
      "set_post_contacts",
      { p_post_id: draft.id, p_expected_revision: draft.revision, p_channels: ["form"] },
      null,
      service
    );
    assert.equal(r.status, service ? 403 : 401);
    assert.equal(r.data.code, "42501");
  }
  record("native-contacts-owner-kind-revision-and-role-boundaries-no-state-change");

  if (controlledSql) {
    stage("contacts concurrent same-revision selection fence");
    const raced = await make("listing", ["form"]),
      financeBeforeRace = financial();
    const barrier = controlledSql(
      "begin; set local idle_in_transaction_session_timeout='30s'; select id from private.posts where id='" +
        raced.id +
        "' for update; select 'EVIDENCE_LOCK_HELD:'||pg_backend_pid();",
      { hold: true }
    );
    const commands = [["form"], ["call"]];
    let pending = [];
    try {
      await barrier.barrier;
      pending = commands.map((channels) =>
        settle(
          rpc(
            "set_post_contacts",
            {
              p_post_id: raced.id,
              p_expected_revision: raced.revision,
              p_channels: channels,
            },
            owner.token
          )
        )
      );
      await awaitQueuedRpc("set_post_contacts", 2);
      barrier.release();
      assert.equal(await barrier.done, 0);
      const responses = await Promise.all(pending.map(complete));
      assert.deepEqual(responses.map((value) => value.status).sort(), [200, 409]);
      const winner = responses.findIndex((value) => value.status === 200);
      assert.deepEqual(responses[winner].data, {
        id: raced.id,
        revision: raced.revision + 1,
        channels: commands[winner],
      });
      assert.equal(responses[1 - winner].data.code, "PT409");
      const after = await read(raced.id);
      assert.equal(after.revision, raced.revision + 1);
      assert.deepEqual(after.channels, commands[winner]);
      assert.equal(financial(), financeBeforeRace);
    } finally {
      barrier.close();
      await barrier.done;
      await Promise.all(pending);
    }
    record("native-contacts-concurrent-selection-one-commit-one-stale-revision-no-financial-write");
  }

  stage("contacts canonical phone assurance distinct from preference");
  sql(
    "update private.verification_phone_proofs set revoked_at=clock_timestamp() where id=\'" +
      initialPhone.proofId +
      "\';"
  );
  let phoneDraft = await make("event", ["whatsapp", "call", "in_app"]);
  assert.deepEqual((await read(phoneDraft.id)).channels, ["call", "whatsapp", "form"]);
  await assert.rejects(
    () => submit(phoneDraft),
    /^Error: Verify your account phone before using Call or WhatsApp$/
  );
  const hash = randomBytes(32).toString("hex"),
    phone = "+278" + String(randomBytes(4).readUInt32BE(0) % 100000000).padStart(8, "0");
  const challenge = await call(
    "create_verification_phone_challenge",
    { p_owner: owner.id, p_phone: phone, p_hash: hash },
    null,
    true
  );
  await call(
    "claim_verification_phone_attempt",
    { p_owner: owner.id, p_challenge: challenge.challenge_id },
    null,
    true
  );
  await call(
    "finalize_verification_phone",
    { p_owner: owner.id, p_challenge: challenge.challenge_id, p_expected_hash: hash },
    null,
    true
  );
  assert.equal((await read(phoneDraft.id)).phone_ready, true);
  const proof = sql(
    "select id from private.verification_phone_proofs where owner_id='" +
      owner.id +
      "' and revoked_at is null;"
  );
  assert.match(proof, /^[a-f0-9-]{36}$/);
  const revoke = () =>
    sql(
      "update private.verification_phone_proofs set revoked_at=clock_timestamp() where id='" +
        proof +
        "';"
    );
  const restore = () =>
    sql("update private.verification_phone_proofs set revoked_at=null where id='" + proof + "';");
  await publish(phoneDraft);
  assert.equal(Object.hasOwn(await read(phoneDraft.id), "phone"), false);
  assert.equal(
    JSON.stringify(await readFoundationPublicPost(publicApi, { id: phoneDraft.id })).includes(
      phone
    ),
    false
  );
  record("native-contacts-real-phone-proof-selected-call-whatsapp-no-number-copy-or-public-leak");

  stage("contacts pending rejected approved edit isolation");
  let original = await current(phoneDraft.id),
    copy = await beginCopy(original);
  assert.deepEqual((await read(copy.id)).channels, ["call", "whatsapp", "form"]);
  let update = await save(copy.id, copy.revision, ["form"]),
    submitted = await submit(update);
  assert.deepEqual((await read(original.id)).channels, ["call", "whatsapp", "form"]);
  await assert.rejects(
    () => save(copy.id, submitted.revision, ["call"]),
    /^Error: Foundation contact preferences unavailable$/
  );
  const frozen = state(original.id);
  const frozenWrite = await rpc(
    "set_post_contacts",
    { p_post_id: original.id, p_expected_revision: original.revision, p_channels: ["form"] },
    owner.token
  );
  assert.equal(frozenWrite.status, 400);
  assert.equal(state(original.id), frozen);
  await decide(submitted, "reject");
  update = await save(copy.id, (await read(copy.id)).revision, ["form"]);
  submitted = await submit(update);
  const money = financial();
  await decide(submitted);
  assert.equal(await read(copy.id), null);
  assert.deepEqual((await read(original.id)).channels, ["form"]);
  assert.equal(financial(), money);
  record("native-contacts-copy-freeze-pending-rejection-and-atomic-merge-financial-stability");

  stage("contacts selected channels participate in price-only classification");
  original = await publish(draft);
  copy = await beginCopy(original);
  const price = await call("save_core_listing_terms", {
    p_id: copy.id,
    p_expected_revision: copy.revision,
    p_terms: { price: { mode: "amount", amount_cents: 10000 }, negotiable: false },
  });
  assert.equal(
    sql("select internal.edit_is_price_only('" + original.id + "','" + copy.id + "');"),
    "t"
  );
  update = await save(copy.id, price.revision, ["in_app", "form"]);
  assert.equal(
    sql("select internal.edit_is_price_only('" + original.id + "','" + copy.id + "');"),
    "t"
  );
  update = await save(copy.id, update.revision, ["call"]);
  assert.equal(
    sql("select internal.edit_is_price_only('" + original.id + "','" + copy.id + "');"),
    "f"
  );
  submitted = await submit(update);
  const approved = await decide(submitted);
  assert.equal(approved.price_only, false);
  assert.deepEqual((await read(original.id)).channels, ["call"]);
  record("native-contacts-price-only-equality-canonical-alias-and-real-contact-change");

  if (controlledSql) {
    assert.equal(typeof awaitQueuedRpc, "function");
    stage("contacts owner caller expiry during write wait");
    const pendingDraft = await make("listing", ["form"]),
      snapshot = state(pendingDraft.id),
      session = JSON.parse(Buffer.from(owner.token.split(".")[1], "base64url")).session_id;
    const notAfter = sql(
      "select coalesce(not_after::text,'') from auth.sessions where id='" + session + "';"
    );
    const expire = () =>
      sql(
        "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" +
          session +
          "';"
      );
    const restoreSession = () =>
      sql(
        "update auth.sessions set not_after=" +
          (notAfter ? "'" + notAfter + "'" : "null") +
          " where id='" +
          session +
          "';"
      );
    const wait = controlledSql(
      "begin; set local idle_in_transaction_session_timeout='30s'; select id from private.posts where id='" +
        pendingDraft.id +
        "' for update; select 'EVIDENCE_LOCK_HELD:'||pg_backend_pid();",
      { hold: true }
    );
    let pending;
    try {
      await wait.barrier;
      pending = settle(
        rpc(
          "set_post_contacts",
          {
            p_post_id: pendingDraft.id,
            p_expected_revision: pendingDraft.revision,
            p_channels: ["call"],
          },
          owner.token
        )
      );
      await awaitQueuedRpc("set_post_contacts");
      expire();
      wait.release();
      assert.equal(await wait.done, 0);
      assert.equal((await complete(pending)).status, 403);
      assert.equal(state(pendingDraft.id), snapshot);
    } finally {
      wait.close();
      await wait.done;
      await pending;
      restoreSession();
    }
    record("native-contacts-owner-session-expiry-after-post-wait-exact-rollback");

    stage("contacts owner phone loss after event quota fence");
    const waitPost = await make("event", ["call"]),
      rootBefore = state(waitPost.id),
      moneyBefore = financial();
    const quota = controlledSql(
      "begin; set local idle_in_transaction_session_timeout='30s'; select pg_advisory_xact_lock(hashtextextended('" +
        owner.id +
        "',909)); select 'EVIDENCE_LOCK_HELD:'||pg_backend_pid();",
      { hold: true }
    );
    let submission;
    try {
      await quota.barrier;
      submission = settle(
        rpc(
          "submit_post",
          { p_post_id: waitPost.id, p_expected_revision: waitPost.revision },
          owner.token
        )
      );
      await awaitQueuedRpc("submit_post");
      revoke();
      quota.release();
      assert.equal(await quota.done, 0);
      const denied = await complete(submission);
      assert.equal(denied.status, 409);
      assert.equal(denied.data.details, "contact_phone_required");
      assert.equal(state(waitPost.id), rootBefore);
      assert.equal(financial(), moneyBefore);
    } finally {
      quota.close();
      await quota.done;
      await submission;
      restore();
    }
    record("native-contacts-phone-proof-revocation-after-submission-wait-no-effects");

    const reviewSession = JSON.parse(
        Buffer.from(reviewer.token.split(".")[1], "base64url")
      ).session_id,
      reviewNotAfter = sql(
        "select coalesce(not_after::text,'') from auth.sessions where id='" + reviewSession + "';"
      );
    const restoreReviewer = () =>
      sql(
        "update auth.sessions set not_after=" +
          (reviewNotAfter ? "'" + reviewNotAfter + "'" : "null") +
          " where id='" +
          reviewSession +
          "';"
      );
    for (const mode of ["media", "projection", "combined"]) {
      stage("contacts reviewer " + mode + " wait and fresh proof/caller denial");
      original = await current(phoneDraft.id);
      copy = await beginCopy(original);
      update = await save(copy.id, copy.revision, ["call"]);
      submitted = await submit(update);
      const lease = await claim(submitted),
        beforeReview = state(original.id),
        moneyReview = financial();
      const blocker = controlledSql(
        "begin; set local idle_in_transaction_session_timeout='30s'; select " +
          (mode === "media"
            ? "id from private.media_objects where id='" + image.object_id
            : "post_id from private.post_search_documents where post_id='" + original.id) +
          "' for update; select 'EVIDENCE_LOCK_HELD:'||pg_backend_pid();",
        { hold: true }
      );
      let decision;
      try {
        await blocker.barrier;
        decision = settle(moderation(submitted, lease));
        await awaitQueuedRpc("moderate_post");
        if (mode === "combined") {
          sql(
            "begin; update private.verification_phone_proofs set revoked_at=clock_timestamp() where id='" +
              proof +
              "'; update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" +
              reviewSession +
              "'; commit;"
          );
          assert.equal(
            sql(
              "select exists(select 1 from private.verification_phone_proofs where id='" +
                proof +
                "' and revoked_at is not null) and exists(select 1 from auth.sessions where id='" +
                reviewSession +
                "' and not_after<clock_timestamp());"
            ),
            "t"
          );
        } else revoke();
        assert.ok(Number.isSafeInteger(blocker.backendPid));
        assert.equal(
          sql(
            "select exists(select 1 from pg_stat_activity a where a.query ilike '%moderate_post%' and " +
              blocker.backendPid +
              "=any(pg_blocking_pids(a.pid)));"
          ),
          "t"
        );
        blocker.release();
        assert.equal(await blocker.done, 0);
        const denied = await complete(decision);
        assert.equal(denied.status, mode === "combined" ? 403 : 409);
        assert.equal(denied.data.code, mode === "combined" ? "42501" : "PT409");
        assert.equal(state(original.id), beforeReview);
        assert.equal(financial(), moneyReview);
      } finally {
        blocker.close();
        await blocker.done;
        await decision;
        restore();
        restoreReviewer();
      }
      await call("discard_post_edit", {
        p_edit_id: copy.id,
        p_expected_revision: submitted.revision,
      });
      record("native-contacts-" + mode + "-wait-fresh-phone-and-caller-authority-exact-rollback");
    }
  }
  stage("contacts cascade deletion and public eligibility cleanup");
  for (const id of [missing.id, phoneDraft.id, draft.id]) {
    const p = await current(id);
    await call("delete_post", { p_post_id: id, p_expected_revision: p.revision });
    assert.equal(
      sql("select count(*) from private.post_contacts where post_id='" + id + "';"),
      "0"
    );
    assert.equal(await readFoundationPublicPost(publicApi, { id }), null);
  }
  assert.equal(
    sql(
      "select count(*) from information_schema.columns where table_schema='private' and table_name='post_contacts' and column_name not in('post_id','post_kind','channels');"
    ),
    "0"
  );
  record("native-contacts-delete-cascades-preferences-without-retained-phone-copy");
}
