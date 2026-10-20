import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import { saveFoundationPostContent } from "../../src/lib/foundation/post-content.ts";
import { readFoundationBusinessEventEditor } from "../../src/lib/foundation/owner-business-event-editor.ts";
import { submitFoundationPost } from "../../src/lib/foundation/post-submission.ts";
import {
  previewFoundationDuplicateEvents,
  flagFoundationDuplicateEvents,
  claimFoundationReport,
  readFoundationDuplicateEventFlag,
  resolveFoundationDuplicateEventFlag,
} from "../../src/lib/foundation/staff-event-duplicate-flags.ts";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };
import { nativeTotp } from "./foundation-native-totp.mjs";
import { captureFoundationFinancialState } from "./foundation-financial-snapshot.mjs";

// Real isolated Auth/TOTP/owner/staff commands. Ready media is synthetic metadata.
// Privileged role/clock/claim setup is labelled and never treated as owner authority.
export async function testStaffEventDuplicateFlags({
  createUser,
  verificationFixture,
  deleteTrackedUser,
  fixtureAdminId,
  connection,
  rpc,
  sql,
  sqlFails,
  record,
  stage,
  controlledSql,
  awaitQueuedRpc,
}) {
  assert.equal(typeof deleteTrackedUser, "function", "Tracked Auth deletion is required");
  stage("staff flags actual TOTP identities");
  const prefix = "sflag" + randomBytes(4).toString("hex"),
    activity = reference.activities.find((row) => row.category === "events").key,
    trackedPosts = [],
    clients = new Map();
  const call = async (user, name, body, service = false) => {
    const response = await rpc(name, body, service ? null : user.token, service);
    assert.equal(response.status, 200, "staff flag fixture " + name);
    return response.data;
  };
  const staff = async (role) => {
    const user = await createUser("staff-flag-" + role);
    user.aal1 = user.token;
    const factor = await user.member.auth.mfa.enroll({ factorType: "totp" });
    assert.equal(factor.error, null);
    const challenge = await user.member.auth.mfa.challenge({ factorId: factor.data.id });
    assert.equal(challenge.error, null);
    assert.equal(
      (
        await user.member.auth.mfa.verify({
          factorId: factor.data.id,
          challengeId: challenge.data.id,
          code: nativeTotp(factor.data.totp.secret),
        })
      ).error,
      null
    );
    user.token = (await user.member.auth.getSession()).data.session.access_token;
    const claims = JSON.parse(Buffer.from(user.token.split(".")[1], "base64url"));
    assert.equal(claims.aal, "aal2");
    assert.equal(claims.sub, user.id);
    sql(
      "insert into private.staff_roles(user_id,role,granted_by) values(\'" +
        user.id +
        "\',\'" +
        role +
        "\',\'" +
        fixtureAdminId +
        "\');"
    );
    user.roleId = sql(
      "select id from private.staff_roles where user_id=\'" + user.id + "\' and revoked_at is null;"
    );
    assert.match(user.roleId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    user.role = role;
    clients.set(user.id, createFoundationAuthenticatedApi(connection, user.token));
    return user;
  };
  const adminA = await staff("admin"),
    adminB = await staff("admin"),
    reviewer = await staff("governor"),
    ownerA = await staff("moderator"),
    ownerB = await staff("moderator");
  await verificationFixture.ready(ownerA);
  await verificationFixture.ready(ownerB);
  const api = (user) => clients.get(user.id);
  const ownerRead = (user, id) => readFoundationBusinessEventEditor(api(user), { id });
  const media = async (user) => {
    const object = await call(user, "begin_media_upload", { p_kind: "image", p_bytes: 128 });
    assert.equal(
      (
        await call(
          user,
          "finalize_media",
          {
            p_object_id: object.object_id,
            p_size: 128,
            p_sha256: createHash("sha256")
              .update(prefix + user.id)
              .digest("hex"),
            p_mime: "image/jpeg",
            p_width: 800,
            p_height: 600,
          },
          true
        )
      ).state,
      "ready"
    );
    return object.object_id;
  };
  const imageA = await media(ownerA),
    imageB = await media(ownerB);
  const reviewPost = async (p) => {
    const claim = await call(reviewer, "claim_queue_item", { p_subject: "post", p_id: p.id });
    assert.equal(
      (
        await call(reviewer, "staff_review_post", {
          p_post_id: p.id,
          p_claim_generation: claim.claim_generation,
          p_claim_nonce: claim.claim_nonce,
        })
      ).revision,
      p.revision
    );
    return claim;
  };
  const approve = (p, claim) =>
    rpc(
      "moderate_post",
      {
        p_post_id: p.id,
        p_expected_revision: p.revision,
        p_decision: "approve",
        p_reason: null,
        p_claim_generation: claim.claim_generation,
        p_claim_nonce: claim.claim_nonce,
      },
      reviewer.token
    );
  const makeEvent = async (user, index, image, publish = true) => {
    const draft = await call(user, "create_core_draft", {
      p_kind: "event",
      p_area: "tourism_events",
      p_category_key: "events",
      p_activity_key: activity,
      p_detail: {
        contact_channels: ["form"],
        starts_at: new Date(Date.now() - 60000).toISOString(),
        ends_at: new Date(Date.now() + 7200000).toISOString(),
        timezone: "Africa/Johannesburg",
      },
    });
    trackedPosts.push(draft.id);
    const content = {
      title: index === 0 ? "😀".repeat(3) : prefix + " Community event",
      description:
        index === 0
          ? "😀".repeat(10)
          : "A synthetic public programme with a possible duplicate description " + index + ".",
      province_id: "gp",
      city_id: "gp_johannesburg",
      locality_label: null,
    };
    const changed = await saveFoundationPostContent(api(user), {
      id: draft.id,
      kind: "event",
      expected_revision: 1,
      content,
    });
    await call(user, "set_post_media", {
      p_post_id: draft.id,
      p_expected_revision: changed.revision,
      p_items: [{ object_id: image, purpose: "cover", position: 0 }],
    });
    let p = await ownerRead(user, draft.id);
    for (let extra = 0; extra < index; extra++) {
      await saveFoundationPostContent(api(user), {
        id: p.id,
        kind: "event",
        expected_revision: p.revision,
        content,
      });
      p = await ownerRead(user, p.id);
    }
    await submitFoundationPost(api(user), { id: p.id, expected_revision: p.revision });
    p = await ownerRead(user, p.id);
    if (!publish) return { owner: user, state: p };
    const claim = await reviewPost(p);
    assert.equal((await approve(p, claim)).status, 200);
    return { owner: user, state: await ownerRead(user, p.id) };
  };
  stage("staff flags real public originals and unequal revisions");
  const entries = [
    await makeEvent(ownerA, 0, imageA),
    await makeEvent(ownerB, 1, imageB),
    await makeEvent(ownerA, 2, imageA),
  ].sort((left, right) => left.state.id.localeCompare(right.state.id));
  const a = entries[0],
    b = entries.slice(1).find((entry) => entry.owner.id !== a.owner.id),
    c = entries.slice(1).find((entry) => entry.state.id !== b.state.id);
  assert.notEqual(a.owner.id, b.owner.id);
  assert.notEqual(a.state.revision, b.state.revision);
  const pair = (left = a, right = b) => ({ post_a: left.state.id, post_b: right.state.id });
  const input = (
    left = a,
    right = b,
    reason = "These public events appear to describe a duplicate programme."
  ) => ({
    ...pair(left, right),
    expected_revision_a: left.state.revision,
    expected_revision_b: right.state.revision,
    reason,
  });
  const rawFlag = (user, value = input()) =>
    rpc(
      "flag_duplicate_events",
      {
        p_post_a: value.post_a,
        p_expected_revision_a: value.expected_revision_a,
        p_post_b: value.post_b,
        p_expected_revision_b: value.expected_revision_b,
        p_reason: value.reason,
      },
      user.token
    );
  const reportHash = () =>
    sql(
      "select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) order by id),'[]')::text,'UTF8')),'hex') from private.reports r;"
    );
  const footprint = () =>
    sql(
      "select encode(sha256(convert_to(jsonb_build_object(" +
        "'reports',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from private.reports r)," +
        "'claims',(select coalesce(jsonb_agg(to_jsonb(q) order by id),'[]') from private.queue_claims q)," +
        "'events',(select count(*) from private.queue_claim_events)," +
        "'audit',(select count(*) from private.evidence_access_log)," +
        "'moderation',(select count(*) from private.moderation_log))::text,'UTF8')),'hex');"
    );
  const product = () => {
    const ids = trackedPosts.map((id) => "'" + id + "'").join(",");
    return sql(
      "select encode(sha256(convert_to(jsonb_build_object(" +
        "'posts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from private.posts t where id in(" +
        ids +
        "))," +
        "'details',(select coalesce(jsonb_agg(to_jsonb(t) order by post_id),'[]') from private.event_details t where post_id in(" +
        ids +
        "))," +
        "'projection',(select coalesce(jsonb_agg(to_jsonb(t) order by post_id),'[]') from private.post_search_documents t where post_id in(" +
        ids +
        "))," +
        "'moderation',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from private.moderation_log t where post_id in(" +
        ids +
        "))," +
        "'decisions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from private.decisions t)," +
        "'closures',(select coalesce(jsonb_agg(to_jsonb(t) order by user_id),'[]') from private.account_closures t))::text,'UTF8')),'hex');"
    );
  };
  const unchanged = async (action, status, code = "42501") => {
    const before = footprint(),
      state = product(),
      finances = captureFoundationFinancialState(sql),
      response = await action();
    assert.equal(response.status, status);
    if (code) assert.equal(response.data.code, code);
    assert.equal(footprint(), before);
    assert.equal(product(), state);
    assert.equal(captureFoundationFinancialState(sql), finances);
    return response;
  };
  const preview = await previewFoundationDuplicateEvents(api(adminA), pair(b, a));
  assert.equal(preview.post_a.id, a.state.id);
  assert.equal(preview.post_b.id, b.state.id);
  assert.equal(preview.post_a.revision, a.state.revision);
  assert.equal(preview.open_flag_id, null);
  const unicode = entries.find((entry) => entry.state.content.title === "😀".repeat(3));
  const companion = entries.find((entry) => entry.state.id !== unicode.state.id);
  const unicodePreview = await previewFoundationDuplicateEvents(
    api(adminA),
    pair(unicode, companion)
  );
  assert.ok(
    [unicodePreview.post_a, unicodePreview.post_b].some(
      (post) => post.title === "😀".repeat(3) && post.description === "😀".repeat(10)
    )
  );
  record("native-staff-event-flags-valid-unicode-public-event-preview");
  for (const machine of [false, true]) {
    await unchanged(
      () =>
        rpc(
          "preview_duplicate_events",
          { p_post_a: a.state.id, p_post_b: b.state.id },
          null,
          machine
        ),
      machine ? 403 : 401
    );
    await unchanged(
      () =>
        rpc(
          "flag_duplicate_events",
          {
            p_post_a: a.state.id,
            p_expected_revision_a: a.state.revision,
            p_post_b: b.state.id,
            p_expected_revision_b: b.state.revision,
            p_reason: input().reason,
          },
          null,
          machine
        ),
      machine ? 403 : 401
    );
  }
  for (const user of [reviewer, ownerA, ownerB])
    await unchanged(
      () =>
        rpc("preview_duplicate_events", { p_post_a: a.state.id, p_post_b: b.state.id }, user.token),
      403
    );
  await unchanged(
    () =>
      rpc(
        "flag_duplicate_events",
        {
          p_post_a: a.state.id,
          p_expected_revision_a: a.state.revision,
          p_post_b: b.state.id,
          p_expected_revision_b: b.state.revision,
          p_reason: input().reason,
        },
        adminA.aal1
      ),
    403
  );
  await unchanged(
    () => rawFlag(adminA, { ...input(), expected_revision_a: a.state.revision - 1 }),
    409,
    "PT409"
  );
  for (const user of [reviewer, ownerA, ownerB]) await unchanged(() => rawFlag(user), 403);
  await unchanged(() => rawFlag(adminA, input(a, a)), 400, "22023");
  const privateEntry = await makeEvent(ownerA, 3, imageA, false);
  assert.equal(privateEntry.state.status, "pending_moderation");
  await unchanged(
    () =>
      rawFlag(adminA, {
        ...input(),
        post_b: privateEntry.state.id,
        expected_revision_b: privateEntry.state.revision,
      }),
    400,
    "22023"
  );
  await unchanged(
    () =>
      rpc(
        "preview_duplicate_events",
        { p_post_a: a.state.id, p_post_b: privateEntry.state.id },
        adminA.token
      ),
    400,
    "22023"
  );
  record("native-staff-event-flags-real-aal2-preview-capability-aal1-and-stale-pair-denials");

  stage("staff flags genuinely Auth-signed stale MFA and exact AMR restoration");
  const freshClaims = JSON.parse(Buffer.from(adminA.token.split(".")[1], "base64url"));
  const amrRows = JSON.parse(
    sql(
      "select coalesce(jsonb_agg(jsonb_build_object('id',id,'created',quote_literal(created_at::text)||'::timestamptz','updated',quote_literal(updated_at::text)||'::timestamptz') order by id),'[]') from auth.mfa_amr_claims where session_id='" +
        freshClaims.session_id +
        "' and authentication_method='totp';"
    )
  );
  assert.equal(amrRows.length, 1);
  const amr = amrRows[0];
  assert.match(amr.id, /^[a-f0-9-]{36}$/);
  const amrRow = () =>
    sql(
      "select to_jsonb(t)::text from auth.mfa_amr_claims t where id='" +
        amr.id +
        "' and session_id='" +
        freshClaims.session_id +
        "';"
    );
  const originalAmr = amrRow();
  const replaceCallerSession = (response) => {
    assert.equal(response.error, null);
    adminA.token = response.data.session.access_token;
    clients.set(adminA.id, createFoundationAuthenticatedApi(connection, adminA.token));
    return JSON.parse(Buffer.from(adminA.token.split(".")[1], "base64url"));
  };
  try {
    // Explicit synthetic clock aging in Auth storage; no JWT is fabricated.
    sql(
      "update auth.mfa_amr_claims set created_at=clock_timestamp()-interval '21 minutes',updated_at=clock_timestamp()-interval '20 minutes' where id='" +
        amr.id +
        "' and session_id='" +
        freshClaims.session_id +
        "' and authentication_method='totp';"
    );
    const stale = replaceCallerSession(await adminA.member.auth.refreshSession());
    assert.equal(stale.sub, adminA.id);
    assert.equal(stale.session_id, freshClaims.session_id);
    assert.equal(stale.aal, "aal2");
    const totpClaims = stale.amr.filter((row) => row.method === "totp");
    assert.equal(totpClaims.length, 1);
    assert.ok(totpClaims[0].timestamp < Math.floor(Date.now() / 1000) - 19 * 60);
    assert.equal(
      sql(
        "select count(*) from auth.sessions where id='" +
          stale.session_id +
          "' and user_id='" +
          adminA.id +
          "' and aal='aal2' and (not_after is null or not_after>clock_timestamp());"
      ),
      "1"
    );
    for (const invoke of [
      () =>
        rpc(
          "preview_duplicate_events",
          { p_post_a: a.state.id, p_post_b: b.state.id },
          adminA.token
        ),
      () => rawFlag(adminA),
    ]) {
      const denied = await unchanged(invoke, 403);
      assert.equal(denied.data.message, "recent second-factor verification required");
    }
    await assert.rejects(
      () => previewFoundationDuplicateEvents(api(adminA), pair()),
      /^Error: Foundation duplicate-event preview unavailable$/
    );
    await assert.rejects(
      () => flagFoundationDuplicateEvents(api(adminA), input()),
      /^Error: Foundation duplicate-event flag unavailable$/
    );
  } finally {
    sql(
      "update auth.mfa_amr_claims set created_at=" +
        amr.created +
        ",updated_at=" +
        amr.updated +
        " where id='" +
        amr.id +
        "' and session_id='" +
        freshClaims.session_id +
        "';"
    );
    assert.equal(amrRow(), originalAmr);
    const restored = replaceCallerSession(await adminA.member.auth.refreshSession());
    assert.equal(restored.sub, adminA.id);
    assert.equal(restored.session_id, freshClaims.session_id);
    assert.equal(restored.aal, "aal2");
    assert.ok(
      restored.amr.some(
        (row) => row.method === "totp" && row.timestamp >= Math.floor(Date.now() / 1000) - 15 * 60
      )
    );
    assert.equal(amrRow(), originalAmr);
  }
  assert.equal((await previewFoundationDuplicateEvents(api(adminA), pair())).post_a.id, a.state.id);
  record("native-staff-event-flags-auth-signed-stale-mfa-denial-and-exact-amr-restoration");

  // Capture after intentional pending-event setup, before the flag operations under test.
  const originalProduct = product(),
    originalFinances = captureFoundationFinancialState(sql);
  stage("staff flags canonical concurrent creation and idempotence");
  let created;
  if (controlledSql && awaitQueuedRpc) {
    const lock = controlledSql(
      "begin;select id from private.posts where id='" +
        a.state.id +
        "' for no key update;select 'EVIDENCE_LOCK_HELD';select pg_sleep(4);commit;"
    );
    let attempts;
    try {
      await lock.barrier;
      attempts = [
        rawFlag(adminA, input(b, a, "First synthetic administrator duplicate statement.")),
        rawFlag(adminB, input(a, b, "Second synthetic administrator duplicate statement.")),
      ].map((p) =>
        p.then(
          (value) => ({ value }),
          (error) => ({ error })
        )
      );
      await awaitQueuedRpc("flag_duplicate_events", 2);
      assert.equal(await lock.done, 0);
      const responses = await Promise.all(attempts);
      for (const r of responses) if (r.error) throw r.error;
      assert.deepEqual(
        responses.map((r) => r.value.status),
        [200, 200]
      );
      assert.deepEqual(responses.map((r) => r.value.data.reused).sort(), [false, true]);
      assert.equal(responses[0].value.data.id, responses[1].value.data.id);
      created = responses[0].value.data;
      record("native-staff-event-flags-concurrent-reversed-pair-exactly-one-open-report");
    } finally {
      lock.close();
      await lock.done;
      if (attempts) await Promise.all(attempts);
    }
  } else created = await flagFoundationDuplicateEvents(api(adminA), input(b, a));
  assert.equal(created.post_a, a.state.id);
  assert.equal(created.post_b, b.state.id);
  const reportId = created.id;
  stage("staff flags canonical acknowledgements and stored revision mapping");
  const stored = JSON.parse(
    sql("select to_jsonb(r) from private.reports r where id='" + reportId + "';")
  );
  assert.equal(stored.report_origin, "staff");
  assert.equal(stored.reporter_ip_hmac, null);
  assert.equal(stored.duplicate_revision_a, a.state.revision);
  assert.equal(stored.duplicate_revision_b, b.state.revision);
  assert.equal(stored.subject_account_id, a.owner.id);
  assert.equal(stored.duplicate_owner_b, b.owner.id);
  const creator = [adminA, adminB].find((user) => user.id === stored.duplicate_created_by),
    controller = [adminA, adminB].find((user) => user.id !== creator.id);
  stage("staff flags immutable idempotent retry");
  const beforeRetry = reportHash();
  const repeated = await flagFoundationDuplicateEvents(
    api(controller),
    input(b, a, "A retry must preserve the first immutable statement.")
  );
  assert.equal(repeated.id, reportId);
  assert.equal(repeated.reused, true);
  assert.equal(reportHash(), beforeRetry);
  stage("staff flags shared-primary second pair");
  const otherFlag = await flagFoundationDuplicateEvents(api(creator), input(c, a));
  assert.notEqual(otherFlag.id, reportId);
  assert.equal(
    sql(
      "select count(*) from private.reports where report_origin='staff' and duplicate_post_a='" +
        a.state.id +
        "' and status='open';"
    ),
    "2"
  );
  assert.equal(product(), originalProduct);
  assert.equal(captureFoundationFinancialState(sql), originalFinances);
  record("native-staff-event-flags-idempotent-immutable-reversed-revisions-and-shared-primary");

  stage("staff flags public report origin and fingerprint boundary");
  const publicBody = {
    p_post_id: a.state.id,
    p_category: "scam",
    p_description: "A synthetic public report about this community event.",
    p_reporter_id: reviewer.id,
    p_reporter_ip_hmac: createHash("sha256")
      .update(prefix + "synthetic-public-ip")
      .digest("base64url"),
  };
  await unchanged(
    () => rpc("submit_report", { ...publicBody, p_category: "duplicate_event" }, null, true),
    400,
    "22023"
  );
  await unchanged(
    () => rpc("submit_report", { ...publicBody, p_reporter_ip_hmac: null }, null, true),
    400,
    "22023"
  );
  await unchanged(
    () => rpc("submit_report", { ...publicBody, p_report_origin: "staff" }, null, true),
    404,
    "PGRST202"
  );
  assert.equal((await rpc("submit_report", publicBody, null, true)).status, 200);
  await unchanged(() => rpc("submit_report", publicBody, null, true), 409, "PT409");
  assert.equal(
    (await rpc("submit_report", { ...publicBody, p_reporter_id: null }, null, true)).status,
    200
  );
  await unchanged(
    () => rpc("submit_report", { ...publicBody, p_reporter_id: null }, null, true),
    409,
    "PT409"
  );
  sqlFails(
    "update private.reports set description='An attempted replacement of the original statement.' where id='" +
      reportId +
      "';",
    "23514"
  );
  assert.equal(
    sql(
      "select tgenabled from pg_trigger where tgrelid='private.reports'::regclass and tgname='reports_identity';"
    ),
    "O"
  );
  record("native-staff-event-flags-public-intake-category-origin-ip-and-old-dedupe-preserved");

  const reportInput = (lease) => ({
    report_id: reportId,
    claim_generation: lease.claim_generation,
    claim_nonce: lease.claim_nonce,
  });
  let lease = await claimFoundationReport(api(reviewer), { report_id: reportId });
  const viewed = await readFoundationDuplicateEventFlag(api(reviewer), reportInput(lease));
  assert.equal(viewed.post_a.id, a.state.id);
  assert.equal(viewed.post_b.id, b.state.id);
  assert.equal(viewed.post_a.current.revision, a.state.revision);
  stage("staff flags creator and both owners conflict every report operation");
  for (const subject of [
    ...new Map([creator, a.owner, b.owner].map((user) => [user.id, user])).values(),
  ]) {
    const oldRole = subject.role;
    if (subject === creator)
      sql("update private.staff_roles set role='governor' where id='" + subject.roleId + "';");
    try {
      await unchanged(
        () => rpc("claim_queue_item", { p_subject: "report", p_id: reportId }, subject.token),
        403
      );
      const batch = await call(subject, "claim_queue_items", { p_queue: "reports", p_limit: 25 });
      assert.equal(
        batch.some((row) => row.id === reportId),
        false
      );
      for (const item of batch)
        await call(subject, "release_queue_claim", {
          p_subject: "report",
          p_id: item.id,
          p_claim_generation: item.claim_generation,
          p_claim_nonce: item.claim_nonce,
        });
      // Explicit conflicted-claim legacy-data fixture, NOT an acquisition proof.
      sql(
        "update private.queue_claims set claimed_by='" +
          subject.id +
          "' where report_id='" +
          reportId +
          "';"
      );
      try {
        await unchanged(
          () =>
            rpc(
              "staff_review_report",
              {
                p_report_id: reportId,
                p_claim_generation: lease.claim_generation,
                p_claim_nonce: lease.claim_nonce,
              },
              subject.token
            ),
          403
        );
        await unchanged(
          () =>
            rpc(
              "resolve_report",
              {
                p_report_id: reportId,
                p_claim_generation: lease.claim_generation,
                p_claim_nonce: lease.claim_nonce,
                p_outcome: "resolved",
                p_note: "Conflicted subject cannot close this report.",
              },
              subject.token
            ),
          403
        );
      } finally {
        sql(
          "update private.queue_claims set claimed_by='" +
            reviewer.id +
            "' where report_id='" +
            reportId +
            "';"
        );
      }
      await unchanged(
        () =>
          rpc(
            "reassign_queue_claim",
            {
              p_subject: "report",
              p_id: reportId,
              p_to: subject.id,
              p_reason: "An independent administrator cannot assign a conflicted reviewer.",
            },
            controller.token
          ),
        400,
        "22023"
      );
    } finally {
      if (subject === creator)
        sql(
          "update private.staff_roles set role='" + oldRole + "' where id='" + subject.roleId + "';"
        );
    }
  }
  // An admin owner must not discover private open-report linkage through preview.
  for (const user of [a.owner, b.owner]) {
    sql("update private.staff_roles set role='admin' where id='" + user.roleId + "';");
    try {
      await unchanged(
        () =>
          rpc(
            "preview_duplicate_events",
            { p_post_a: a.state.id, p_post_b: b.state.id },
            user.token
          ),
        403
      );
      await unchanged(() => rawFlag(user), 403);
    } finally {
      sql(
        "update private.staff_roles set role='" + user.role + "' where id='" + user.roleId + "';"
      );
    }
  }
  await unchanged(
    () =>
      rpc(
        "reassign_queue_claim",
        {
          p_subject: "report",
          p_id: reportId,
          p_to: null,
          p_reason: "A flag creator cannot control their own independent review.",
        },
        creator.token
      ),
    403
  );
  record(
    "native-staff-event-flags-creator-primary-related-owner-individual-bulk-read-resolve-reassign-conflicts"
  );

  stage("staff flags actual session and role loss across pair/report/claim waits");
  if (controlledSql && awaitQueuedRpc) {
    const sessionOf = (user) =>
      JSON.parse(Buffer.from(user.token.split(".")[1], "base64url")).session_id;
    const sessionDeadline = (user) =>
      sql(
        "select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='" +
          sessionOf(user) +
          "' and user_id='" +
          user.id +
          "';"
      );
    const waitDenied = async (label, user, name, lockQuery, invoke, mutation, restore) => {
      stage("staff flags " + label);
      const before = footprint(),
        state = product(),
        financial = captureFoundationFinancialState(sql);
      const lock = controlledSql(
        "begin;" + lockQuery + ";select 'EVIDENCE_LOCK_HELD';select pg_sleep(4);commit;"
      );
      let pending;
      try {
        await lock.barrier;
        pending = invoke().then(
          (value) => ({ value }),
          (error) => ({ error })
        );
        await awaitQueuedRpc(name);
        mutation();
        assert.equal(await lock.done, 0);
        const outcome = await pending;
        if (outcome.error) throw outcome.error;
        assert.equal(outcome.value.status, 403);
        assert.equal(outcome.value.data.code, "42501");
        assert.equal(footprint(), before);
        assert.equal(product(), state);
        assert.equal(captureFoundationFinancialState(sql), financial);
      } finally {
        lock.close();
        await lock.done;
        if (pending) await pending;
        restore();
      }
      record(
        "native-staff-event-flags-" + label + "-fresh-denial-no-report-audit-or-product-write"
      );
    };
    await waitDenied(
      "pair-role-revocation-before-idempotent-response",
      controller,
      "flag_duplicate_events",
      "select id from private.posts where id='" + a.state.id + "' for no key update",
      () => rawFlag(controller),
      () =>
        sql(
          "update private.staff_roles set revoked_at=clock_timestamp(),revoked_by='" +
            fixtureAdminId +
            "' where id='" +
            controller.roleId +
            "';"
        ),
      () =>
        sql(
          "update private.staff_roles set revoked_at=null,revoked_by=null where id='" +
            controller.roleId +
            "';"
        )
    );
    for (const boundary of ["pair", "preview", "report", "claim"]) {
      const pairBoundary = boundary === "pair" || boundary === "preview";
      const user = pairBoundary ? creator : reviewer,
        prior = sessionDeadline(user);
      assert.ok(prior);
      await waitDenied(
        boundary + "-actual-session-expiry",
        user,
        boundary === "pair"
          ? "flag_duplicate_events"
          : boundary === "preview"
            ? "preview_duplicate_events"
            : "staff_review_report",
        pairBoundary
          ? "select id from private.posts where id='" + a.state.id + "' for no key update"
          : boundary === "report"
            ? "select id from private.reports where id='" + reportId + "' for update"
            : "select id from private.queue_claims where report_id='" + reportId + "' for update",
        () =>
          boundary === "pair"
            ? rawFlag(user)
            : boundary === "preview"
              ? rpc(
                  "preview_duplicate_events",
                  { p_post_a: a.state.id, p_post_b: b.state.id },
                  user.token
                )
              : rpc(
                  "staff_review_report",
                  {
                    p_report_id: reportId,
                    p_claim_generation: lease.claim_generation,
                    p_claim_nonce: lease.claim_nonce,
                  },
                  user.token
                ),
        () =>
          sql(
            "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" +
              sessionOf(user) +
              "' and user_id='" +
              user.id +
              "';"
          ),
        () =>
          sql(
            "update auth.sessions set not_after=" +
              prior +
              " where id='" +
              sessionOf(user) +
              "' and user_id='" +
              user.id +
              "';"
          )
      );
    }
  }

  stage("staff flags claim rotation expiry and human closure without enforcement");
  const oldLease = lease;
  lease = await claimFoundationReport(api(reviewer), { report_id: reportId });
  await unchanged(
    () =>
      rpc(
        "staff_review_report",
        {
          p_report_id: reportId,
          p_claim_generation: oldLease.claim_generation,
          p_claim_nonce: oldLease.claim_nonce,
        },
        reviewer.token
      ),
    403
  );
  await unchanged(
    () =>
      rpc(
        "resolve_report",
        {
          p_report_id: reportId,
          p_claim_generation: oldLease.claim_generation,
          p_claim_nonce: oldLease.claim_nonce,
          p_outcome: "resolved",
          p_note: "A rotated claim must not close a report.",
        },
        reviewer.token
      ),
    403
  );
  sql(
    "update private.queue_claims set claimed_at=clock_timestamp()-interval '20 minutes',claim_expires_at=clock_timestamp()-interval '1 second' where report_id='" +
      reportId +
      "';"
  );
  await unchanged(
    () =>
      rpc(
        "staff_review_report",
        {
          p_report_id: reportId,
          p_claim_generation: lease.claim_generation,
          p_claim_nonce: lease.claim_nonce,
        },
        reviewer.token
      ),
    403
  );
  await unchanged(
    () =>
      rpc(
        "resolve_report",
        {
          p_report_id: reportId,
          p_claim_generation: lease.claim_generation,
          p_claim_nonce: lease.claim_nonce,
          p_outcome: "resolved",
          p_note: "An expired claim must not close a report.",
        },
        reviewer.token
      ),
    403
  );
  lease = await claimFoundationReport(api(reviewer), { report_id: reportId });
  const beforeClose = product(),
    financeClose = captureFoundationFinancialState(sql);
  assert.equal(
    (await readFoundationDuplicateEventFlag(api(reviewer), reportInput(lease))).id,
    reportId
  );
  assert.deepEqual(
    await resolveFoundationDuplicateEventFlag(api(reviewer), {
      ...reportInput(lease),
      outcome: "dismissed",
      note: "Separate programmes confirmed after the independent comparison.",
    }),
    { id: reportId, status: "dismissed" }
  );
  assert.equal(product(), beforeClose);
  assert.equal(captureFoundationFinancialState(sql), financeClose);
  const reopened = await flagFoundationDuplicateEvents(api(controller), input());
  assert.notEqual(reopened.id, reportId);
  assert.equal(reopened.reused, false);
  record(
    "native-staff-event-flags-current-claim-rotation-expiry-resolution-and-explicit-reflag-no-enforcement"
  );

  if (controlledSql && awaitQueuedRpc) {
    stage("staff flags actual edit approval wins before stale pair request");
    const oldB = await ownerRead(b.owner, b.state.id),
      staleInput = input();
    const copy = await call(b.owner, "create_post_edit", {
      p_post_id: oldB.id,
      p_expected_revision: oldB.revision,
    });
    trackedPosts.push(copy.id);
    await saveFoundationPostContent(api(b.owner), {
      id: copy.id,
      kind: "event",
      expected_revision: 1,
      content: { ...oldB.content, title: oldB.content.title + " reviewed correction" },
    });
    let pending = await ownerRead(b.owner, copy.id);
    await submitFoundationPost(api(b.owner), {
      id: pending.id,
      expected_revision: pending.revision,
    });
    pending = await ownerRead(b.owner, copy.id);
    const claim = await reviewPost(pending),
      beforeReports = reportHash(),
      beforeFinances = captureFoundationFinancialState(sql);
    const lock = controlledSql(
      "begin;select id from private.posts where id='" +
        b.state.id +
        "' for update;select 'EVIDENCE_LOCK_HELD';select pg_sleep(4);commit;"
    );
    let approving, flagging;
    try {
      await lock.barrier;
      approving = approve(pending, claim).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      await awaitQueuedRpc("moderate_post");
      flagging = rawFlag(controller, staleInput).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      await awaitQueuedRpc("flag_duplicate_events");
      assert.equal(await lock.done, 0);
      const results = await Promise.all([approving, flagging]);
      for (const r of results) if (r.error) throw r.error;
      assert.equal(results[0].value.status, 200);
      assert.equal(results[1].value.status, 409);
      assert.equal(results[1].value.data.code, "PT409");
      assert.equal(results[1].value.data.details, "event_pair_changed");
      assert.equal(reportHash(), beforeReports);
      assert.equal(captureFoundationFinancialState(sql), beforeFinances);
    } finally {
      lock.close();
      await lock.done;
      if (approving) await approving;
      if (flagging) await flagging;
    }
    b.state = await ownerRead(b.owner, b.state.id);
    assert.equal(b.state.revision, oldB.revision + 1);
    const reused = await flagFoundationDuplicateEvents(api(controller), input());
    assert.equal(reused.id, reopened.id);
    assert.equal(reused.reused, true);
    assert.equal(reportHash(), beforeReports);
    record(
      "native-staff-event-flags-actual-edit-approval-before-queued-flag-rechecks-both-revisions"
    );
  }

  stage("staff flags actual reporter deletion and primary-post FK nulling");
  // This synthetic administrator owns no post, claim or audit row. Its role is
  // removed as explicit fixture setup; the actual GoTrue deletion performs FK nulling.
  if (deleteTrackedUser) {
    sql("delete from private.staff_roles where user_id='" + creator.id + "';");
    await deleteTrackedUser(creator.id);
    assert.equal(
      sql(
        "select (reporter_id is null and duplicate_created_by='" +
          creator.id +
          "')::text from private.reports where id='" +
          reportId +
          "';"
      ),
      "true"
    );
    assert.equal(
      sql("select internal.queue_conflict('" + creator.id + "',null,'" + reportId + "')::text;"),
      "true"
    );
    record(
      "native-staff-event-flags-actual-reporter-auth-deletion-preserves-creator-conflict-snapshot"
    );
  }
  const remaining = await claimFoundationReport(api(reviewer), { report_id: reopened.id });
  stage("staff flags actual related owner deletion wins before queued flag");
  const beforeRelatedReports = reportHash(),
    beforeRelatedFinances = captureFoundationFinancialState(sql);
  const deletionArgs = { p_post_id: b.state.id, p_expected_revision: b.state.revision };
  if (controlledSql && awaitQueuedRpc) {
    const lock = controlledSql(
      "begin;select id from private.posts where id='" +
        b.state.id +
        "' for update;select 'EVIDENCE_LOCK_HELD';select pg_sleep(4);commit;"
    );
    let deleting, flagging;
    try {
      await lock.barrier;
      deleting = rpc("delete_post", deletionArgs, b.owner.token).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      await awaitQueuedRpc("delete_post");
      flagging = rawFlag(controller).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      await awaitQueuedRpc("flag_duplicate_events");
      assert.equal(await lock.done, 0);
      const results = await Promise.all([deleting, flagging]);
      for (const r of results) if (r.error) throw r.error;
      assert.equal(results[0].value.status, 200);
      assert.equal(results[1].value.status, 400);
      assert.equal(results[1].value.data.code, "22023");
    } finally {
      lock.close();
      await lock.done;
      if (deleting) await deleting;
      if (flagging) await flagging;
    }
    record("native-staff-event-flags-actual-related-delete-before-queued-flag-no-partial-report");
  } else await call(b.owner, "delete_post", deletionArgs);
  assert.equal(reportHash(), beforeRelatedReports);
  assert.equal(captureFoundationFinancialState(sql), beforeRelatedFinances);
  const relatedView = await readFoundationDuplicateEventFlag(api(reviewer), {
    report_id: reopened.id,
    claim_generation: remaining.claim_generation,
    claim_nonce: remaining.claim_nonce,
  });
  assert.equal(relatedView.post_a.current.id, a.state.id);
  assert.equal(relatedView.post_b.current, null);

  const currentA = await ownerRead(a.owner, a.state.id);
  await call(a.owner, "delete_post", {
    p_post_id: currentA.id,
    p_expected_revision: currentA.revision,
  });
  assert.equal(
    sql(
      "select (post_id is null and duplicate_post_a='" +
        a.state.id +
        "')::text from private.reports where id='" +
        reopened.id +
        "';"
    ),
    "true"
  );
  const afterDelete = await readFoundationDuplicateEventFlag(api(reviewer), {
    report_id: reopened.id,
    claim_generation: remaining.claim_generation,
    claim_nonce: remaining.claim_nonce,
  });
  assert.equal(afterDelete.post_a.current, null);
  assert.equal(afterDelete.post_b.current, null);
  await unchanged(() => rawFlag(controller), 400, "22023");
  assert.equal(
    sql(
      "select internal.queue_conflict('" +
        a.owner.id +
        "',null,'" +
        reopened.id +
        "')::text||internal.queue_conflict('" +
        b.owner.id +
        "',null,'" +
        reopened.id +
        "')::text;"
    ),
    "truetrue"
  );
  record(
    "native-staff-event-flags-actual-primary-delete-preserves-pair-owner-conflicts-and-current-or-null-review"
  );

  if (controlledSql && awaitQueuedRpc) {
    stage("staff flags event deadline passes during actual pair lock wait");
    const target = await makeEvent(ownerB, 4, imageB);
    const temporalInput = input(c, target);
    // Explicit privileged deadline setup; production owner APIs cannot rewrite
    // a live event. Actual clock passage and an authenticated flag are tested.
    sql(
      "update private.event_details set ends_at=date_trunc('milliseconds',clock_timestamp()+interval '5 seconds') where post_id='" +
        target.state.id +
        "';"
    );
    const before = reportHash(),
      state = product(),
      finances = captureFoundationFinancialState(sql);
    const lock = controlledSql(
      "begin;select id from private.posts where id='" +
        target.state.id +
        "' for update;select 'EVIDENCE_LOCK_HELD';select pg_sleep(7);commit;"
    );
    let flagging;
    try {
      await lock.barrier;
      flagging = rawFlag(controller, temporalInput).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      await awaitQueuedRpc("flag_duplicate_events");
      assert.equal(
        sql(
          "select (ends_at>clock_timestamp())::text from private.event_details where post_id=\'" +
            target.state.id +
            "\';"
        ),
        "true"
      );
      assert.equal(await lock.done, 0);
      const outcome = await flagging;
      if (outcome.error) throw outcome.error;
      assert.equal(outcome.value.status, 400);
      assert.equal(outcome.value.data.code, "22023");
      assert.equal(
        sql(
          "select (ends_at<=clock_timestamp())::text from private.event_details where post_id='" +
            target.state.id +
            "';"
        ),
        "true"
      );
      assert.equal(reportHash(), before);
      assert.equal(product(), state);
      assert.equal(captureFoundationFinancialState(sql), finances);
    } finally {
      lock.close();
      await lock.done;
      if (flagging) await flagging;
    }
    record("native-staff-event-flags-fresh-event-deadline-after-pair-wait-no-partial-report");
  }
}
