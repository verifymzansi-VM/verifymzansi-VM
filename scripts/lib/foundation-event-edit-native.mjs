import { captureFoundationFinancialState } from "./foundation-financial-snapshot.mjs";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createFoundationPublicApi } from "../../src/lib/foundation/public-api.ts";
import { readFoundationPublicPost } from "../../src/lib/foundation/public-post.ts";
import { saveFoundationPostContent } from "../../src/lib/foundation/post-content.ts";

// Real core publication commands; scanner finalization is synthetic metadata.
// SQL clock aging is explicit fixture setup, never an owner permission.
export async function testEventContextApprovals({
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
}) {
  stage("event public client and financial snapshot setup");
  const publicApi = createFoundationPublicApi(connection),
    detail = (id) => readFoundationPublicPost(publicApi, { id });
  const prefix = "ctxevt" + randomBytes(4).toString("hex");
  const window = () => ({
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 7200000).toISOString(),
    timezone: "US/Eastern",
  });
  const finances = () => captureFoundationFinancialState(sql);
  let financialBefore = finances();
  stage("event media upload setup");
  const image = await call("begin_media_upload", { p_kind: "image", p_bytes: 128 });
  stage("event synthetic media finalization setup");
  assert.equal(
    (
      await call(
        "finalize_media",
        {
          p_object_id: image.object_id,
          p_size: 128,
          p_sha256: createHash("sha256").update("context synthetic image metadata").digest("hex"),
          p_mime: "image/jpeg",
          p_width: 800,
          p_height: 600,
        },
        null,
        true
      )
    ).state,
    "ready"
  );
  const claims = async (id, revision) => {
    const claim = await call("claim_queue_item", { p_subject: "post", p_id: id }, reviewer.token);
    const view = await call(
      "staff_review_post",
      {
        p_post_id: id,
        p_claim_generation: claim.claim_generation,
        p_claim_nonce: claim.claim_nonce,
      },
      reviewer.token
    );
    assert.equal(view.id, id);
    assert.equal(view.revision, revision);
    return claim;
  };
  const moderation = (id, revision, claim, decision = "approve") =>
    rpc(
      "moderate_post",
      {
        p_post_id: id,
        p_expected_revision: revision,
        p_decision: decision,
        p_reason: decision === "reject" ? "Synthetic context correction" : null,
        p_claim_generation: claim.claim_generation,
        p_claim_nonce: claim.claim_nonce,
      },
      reviewer.token
    );
  const decide = async (id, revision, decision = "approve") => {
    const claim = await claims(id, revision),
      result = await moderation(id, revision, claim, decision);
    assert.equal(result.status, 200, `event context ${decision}`);
    return result.data;
  };
  const makeEvent = async (label) => {
    const w = window();
    const post = await call("create_core_draft", {
      p_kind: "event",
      p_area: "tourism_events",
      p_category_key: "events",
      p_activity_key: eventKeys[0],
      p_detail: { ...w, contact_channels: ["form"] },
    });
    const content = await saveFoundationPostContent(api, {
      id: post.id,
      kind: "event",
      expected_revision: 1,
      content: {
        title: `${prefix} ${label}`,
        description: "Synthetic event context and approval workflow metadata only.",
        province_id: "gp",
        city_id: "gp_johannesburg",
      },
    });
    const media = await call("set_post_media", {
      p_post_id: post.id,
      p_expected_revision: content.revision,
      p_items: [{ object_id: image.object_id, purpose: "cover", position: 0 }],
    });
    const submitted = await call("submit_post", {
      p_post_id: post.id,
      p_expected_revision: media.revision,
    });
    await decide(post.id, submitted.revision);
    const editor = await read(post.id),
      visible = await detail(post.id);
    assert.equal(editor.status, "live");
    assert.ok(visible);
    assert.equal(Date.parse(visible.visible_until), Date.parse(w.ends_at));
    assert.deepEqual(visible.event_window, w);
    return { id: post.id, window: w, editor, visible };
  };
  const archive = async (id) => {
    const state = await read(id);
    await call("set_post_state", {
      p_post_id: id,
      p_expected_revision: state.revision,
      p_action: "archive",
    });
    assert.equal(await detail(id), null);
  };
  const physical = (id) => {
    const ids = `select p.id from private.posts p where p.id='${id}' or p.edit_of='${id}'`;
    return sql(`select jsonb_build_object(
      'posts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from private.posts p where p.id in (${ids})),
      'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.post_id),'[]') from private.event_details e where e.post_id in (${ids})),
      'links',(select coalesce(jsonb_agg(to_jsonb(m) order by to_jsonb(m)::text),'[]') from private.post_media m where m.post_id in (${ids})),
      'projection',(select coalesce(jsonb_agg(to_jsonb(d) order by d.post_id),'[]') from private.post_search_documents d where d.post_id in (${ids})),
      'claims',(select coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),'[]') from private.queue_claims q where q.post_id in (${ids})),
      'media_objects',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from private.media_objects o where o.id='${image.object_id}'),
      'claim_events',(select coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),'[]') from private.queue_claim_events q),
      'moderation',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from private.moderation_log l where l.post_id='${id}'));`);
  };
  const contextDenied = async (id, revision) => {
    const before = physical(id),
      result = await rpc(
        "save_business_event_context",
        { p_post_id: id, p_expected_revision: revision, p_patch: { activity_key: eventKeys[1] } },
        owner.token
      );
    assert.equal(result.status, 400);
    assert.equal(result.data.code, "22023");
    assert.equal(physical(id), before);
  };
  const copyAndSubmit = async (original, w) => {
    const state = await read(original.id),
      copy = await call("create_post_edit", {
        p_post_id: original.id,
        p_expected_revision: state.revision,
      });
    const changed = await save(copy.id, 1, { activity_key: eventKeys[1], event_window: w });
    const submitted = await call("submit_post", {
      p_post_id: copy.id,
      p_expected_revision: changed.revision,
    });
    return { id: copy.id, revision: submitted.revision };
  };
  const synchronized = (id) =>
    assert.equal(
      sql(
        `select (p.visible_until=e.ends_at and d.visible_until=e.ends_at and d.published_at=p.published_at)::text from private.posts p join private.event_details e on e.post_id=p.id join private.post_search_documents d on d.post_id=p.id where p.id='${id}';`
      ),
      "true"
    );

  stage("event true publish reject extend shorten and edit allowance");
  const main = await makeEvent("main"),
    published = main.visible.published_at;
  assert.equal(finances(), financialBefore);
  // Synthetic capability setup; settlement below uses real local API transactions.
  sql(
    `insert into private.entitlements(owner_id,source,area,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at,addon_capabilities) values('${owner.id}','staff_grant','tourism_events','${reviewer.id}',1,10,1,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '7 days',array['boost']);`
  );
  const addon = JSON.parse(
    sql(
      "select jsonb_build_object('id',id,'amount',price_cents) from private.addon_versions where kind='boost' and retired_at is null order by version desc limit 1;"
    )
  );
  const payment = await call("start_checkout", { p_product_id: addon.id, p_target_post: main.id });
  const request = prefix + "-request";
  await call(
    "attach_provider_request",
    { p_payment_id: payment.payment_id, p_request_id: request },
    null,
    true
  );
  const settled = await call(
    "apply_provider_event",
    {
      p_event: {
        payload_sha256: createHash("sha256").update(prefix).digest("hex"),
        merchant_reference: payment.merchant_reference,
        provider_request_id: request,
        provider_transaction_id: prefix + "-txn",
        status: "complete",
        amount_cents: addon.amount,
        currency: "ZAR",
      },
    },
    null,
    true
  );
  assert.equal(settled.outcome, "completed");
  assert.equal(
    sql(
      `select count(*) from private.post_addon_windows where post_id='${main.id}' and payment_id='${payment.payment_id}';`
    ),
    "1"
  );
  financialBefore = finances();
  await contextDenied(main.id, main.editor.revision);
  const extended = {
    ...main.window,
    ends_at: new Date(Date.parse(main.window.ends_at) + 7200000).toISOString(),
  };
  let copy = await copyAndSubmit(main, extended);
  await contextDenied(copy.id, copy.revision);
  assert.deepEqual(await detail(main.id), main.visible);
  assert.equal(await detail(copy.id), null);
  await decide(copy.id, copy.revision, "reject");
  assert.deepEqual(await detail(main.id), main.visible);
  assert.equal(await detail(copy.id), null);
  const rejected = await read(copy.id);
  assert.equal(rejected.status, "rejected");
  const corrected = await save(copy.id, rejected.revision, { event_window: extended });
  const submitted = await call("submit_post", {
    p_post_id: copy.id,
    p_expected_revision: corrected.revision,
  });
  const approved = await decide(copy.id, submitted.revision);
  assert.equal(approved.price_only, false);
  assert.equal(approved.edit_of, main.id);
  assert.equal(await read(copy.id), null);
  let current = await read(main.id),
    visible = await detail(main.id);
  assert.deepEqual(current.event_window, extended);
  assert.deepEqual(visible.event_window, extended);
  assert.equal(current.activity_key, eventKeys[1]);
  assert.equal(current.revision, approved.post_revision);
  assert.equal(visible.published_at, published);
  assert.equal(Date.parse(visible.visible_until), Date.parse(extended.ends_at));
  synchronized(main.id);
  const shortened = {
    ...main.window,
    ends_at: new Date(Date.parse(main.window.ends_at) + 1800000).toISOString(),
  };
  copy = await copyAndSubmit(main, shortened);
  const beforeSecond = visible;
  assert.deepEqual(await detail(main.id), beforeSecond);
  const second = await decide(copy.id, copy.revision);
  assert.equal(second.price_only, false);
  current = await read(main.id);
  visible = await detail(main.id);
  assert.deepEqual(current.event_window, shortened);
  assert.deepEqual(visible.event_window, shortened);
  assert.equal(visible.published_at, published);
  assert.equal(Date.parse(visible.visible_until), Date.parse(shortened.ends_at));
  synchronized(main.id);
  assert.equal(sql(`select internal.approved_edit_count('${main.id}');`), "2");
  const third = await call("create_post_edit", {
    p_post_id: main.id,
    p_expected_revision: current.revision,
  });
  const thirdChange = await save(third.id, 1, { activity_key: eventKeys[0] });
  const thirdSubmit = await rpc(
    "submit_post",
    { p_post_id: third.id, p_expected_revision: thirdChange.revision },
    owner.token
  );
  assert.equal(thirdSubmit.status, 409);
  assert.equal(thirdSubmit.data.code, "PT409");
  assert.deepEqual(await detail(main.id), visible);
  await call("discard_post_edit", {
    p_edit_id: third.id,
    p_expected_revision: thirdChange.revision,
  });
  assert.equal(
    sql(
      `select count(*) from private.moderation_log where post_id='${main.id}' and edit_id is not null and decision='approve' and not price_only;`
    ),
    "2"
  );
  await archive(main.id);
  assert.equal(finances(), financialBefore);
  record("native-event-context-real-publication-reject-extend-shorten-and-two-edit-cap", {
    financialSnapshot: JSON.parse(financialBefore),
    targetPaidWindow: true,
  });

  const ageOriginal = (original, mode) => {
    if (mode === "original")
      sql(
        `update private.event_details set ends_at=date_trunc('milliseconds',clock_timestamp()+interval '5 seconds') where post_id='${original.id}'; update private.posts set visible_until=(select ends_at from private.event_details where post_id='${original.id}') where id='${original.id}'; select internal.write_post_projection('${original.id}');`
      );
    else if (mode === "visibility")
      sql(
        `update private.posts set visible_until=date_trunc('milliseconds',clock_timestamp()+interval '5 seconds') where id='${original.id}'; select internal.write_post_projection('${original.id}');`
      );
  };
  const cleanupDenied = async (original, copy) => {
    const remaining = await read(copy.id);
    assert.equal(remaining.status, "pending_moderation");
    await call("discard_post_edit", {
      p_edit_id: copy.id,
      p_expected_revision: remaining.revision,
    });
    await archive(original.id);
  };
  for (const which of ["copy", "original"]) {
    stage(`event ${which} deadline before review exact rollback`);
    const original = await makeEvent(which + "-before");
    if (which === "original") ageOriginal(original, "original");
    const w = window();
    if (which === "copy") w.ends_at = new Date(Date.now() - 1000).toISOString();
    const pending = await copyAndSubmit(original, w),
      claim = await claims(pending.id, pending.revision);
    if (which === "original") await new Promise((resolve) => setTimeout(resolve, 5500));
    const before = physical(original.id),
      denied = await moderation(pending.id, pending.revision, claim);
    assert.equal(denied.status, 409);
    assert.equal(denied.data.code, "PT409");
    assert.equal(physical(original.id), before);
    if (which === "copy") assert.ok(await detail(original.id));
    else assert.equal(await detail(original.id), null);
    await cleanupDenied(original, pending);
    assert.equal(finances(), financialBefore);
    record(`native-event-${which}-deadline-before-approval-rolls-back`);
  }

  if (controlledSql && awaitQueuedRpc) {
    for (const scenario of [
      "copy-media",
      "original-media",
      "visibility-media",
      "owner-media",
      "original-projection",
      "copy-projection",
    ]) {
      stage(`event ${scenario} confirmed wait fresh guard and rollback`);
      const original = await makeEvent(scenario);
      if (scenario.startsWith("original")) ageOriginal(original, "original");
      if (scenario.startsWith("visibility")) ageOriginal(original, "visibility");
      const w = window();
      if (scenario.startsWith("copy")) w.ends_at = new Date(Date.now() + 5000).toISOString();
      const pending = await copyAndSubmit(original, w),
        claim = await claims(pending.id, pending.revision),
        before = physical(original.id);
      // Capture the old committed deadline before approval changes any rows.
      const deadline = scenario.startsWith("owner")
        ? null
        : sql(
            `select quote_literal(${scenario.startsWith("visibility") ? "p.visible_until" : "e.ends_at"}::text)||'::timestamptz' from private.posts p join private.event_details e on e.post_id=p.id where p.id='${scenario.startsWith("copy") ? pending.id : original.id}';`
          );
      if (deadline !== null) assert.ok(deadline);
      const projection = scenario.endsWith("projection");
      const lock = controlledSql(
        projection
          ? `begin; select post_id from private.post_search_documents where post_id='${original.id}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(7); commit;`
          : `begin; select id from private.media_objects where id='${image.object_id}' for update; select 'EVIDENCE_LOCK_HELD'; select pg_sleep(7); commit;`
      );
      let approving;
      const banned = sql(
        `select case when banned_until is null then 'null' else quote_literal(banned_until::text)||'::timestamptz' end from auth.users where id='${owner.id}';`
      );
      assert.ok(banned);
      try {
        await lock.barrier;
        approving = moderation(pending.id, pending.revision, claim).then(
          (result) => ({ result }),
          (error) => ({ error })
        );
        await awaitQueuedRpc("moderate_post");
        if (deadline !== null)
          assert.equal(
            sql(`select (${deadline}>clock_timestamp())::text;`),
            "true",
            "deadline must still be future at confirmed wait"
          );
        if (scenario.startsWith("owner"))
          sql(
            `update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='${owner.id}';`
          );
        assert.equal(await lock.done, 0);
        if (deadline !== null)
          assert.equal(
            sql(`select (${deadline}<=clock_timestamp())::text;`),
            "true",
            "deadline must expire during the wait"
          );
        const outcome = await approving;
        if (outcome.error) throw outcome.error;
        const denied = outcome.result;
        assert.equal(denied.status, 409);
        assert.equal(denied.data.code, "PT409");
        assert.equal(physical(original.id), before);
      } finally {
        lock.close();
        await lock.done;
        if (approving) await approving;
        sql(`update auth.users set banned_until=${banned} where id='${owner.id}';`);
      }
      if (scenario.startsWith("copy") || scenario.startsWith("owner"))
        assert.ok(await detail(original.id));
      else assert.equal(await detail(original.id), null);
      await cleanupDenied(original, pending);
      assert.equal(finances(), financialBefore);
      record(`native-event-${scenario}-wait-fresh-eligibility-and-exact-rollback`);
    }
  }

  stage("event paused original merge preserves publication state and financial rows");
  const paused = await makeEvent("paused"),
    w = window(),
    pending = await copyAndSubmit(paused, w),
    claim = await claims(pending.id, pending.revision);
  const live = await read(paused.id);
  await call("set_post_state", {
    p_post_id: paused.id,
    p_expected_revision: live.revision,
    p_action: "pause",
  });
  const stamps = () =>
    sql(
      `select jsonb_build_object('published_at',published_at,'created_at',created_at,'submitted_at',submitted_at,'status_changed_at',status_changed_at,'status',status) from private.posts where id='${paused.id}';`
    );
  const beforeStamps = stamps(),
    accepted = await moderation(pending.id, pending.revision, claim);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.price_only, false);
  assert.equal(stamps(), beforeStamps);
  assert.equal((await read(paused.id)).status, "paused");
  assert.deepEqual((await read(paused.id)).event_window, w);
  assert.equal(await detail(paused.id), null);
  synchronized(paused.id);
  assert.equal(finances(), financialBefore);
  await archive(paused.id);
  record("native-event-paused-approval-preserves-state-publication-stamps-and-financial-rows");
}
