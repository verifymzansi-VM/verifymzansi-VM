import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import { createTimeoutFetch } from "../../src/lib/supabase/fetch-with-timeout.ts";
import { saveFoundationPostContent } from "../../src/lib/foundation/post-content.ts";
import { readFoundationBusinessEventEditor } from "../../src/lib/foundation/owner-business-event-editor.ts";
import { saveFoundationBusinessEventContext } from "../../src/lib/foundation/business-event-context.ts";
import { submitFoundationPost } from "../../src/lib/foundation/post-submission.ts";
import { captureFoundationFinancialState } from "./foundation-financial-snapshot.mjs";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };

// Real local owner/staff RPCs and synthetic ready-image metadata only.
// No physical scanner or provider assurance; no reports are fabricated.
export async function testEventDuplicateAdmission({
  createUser,
  verificationFixture,
  reviewer,
  connection,
  rpc,
  sql,
  record,
  stage,
  controlledSql,
  awaitQueuedRpc,
}) {
  stage("duplicate fresh owners and normalization preflight");
  const prefix = "dupe" + randomBytes(4).toString("hex"),
    keys = reference.activities.filter((r) => r.category === "events").map((r) => r.key),
    owner = await createUser("duplicate-owner"),
    other = await createUser("duplicate-other");
  await verificationFixture.ready(owner);
  await verificationFixture.ready(other);
  assert.ok(keys.length > 1);
  assert.equal(sql("show server_encoding;"), "UTF8");
  assert.equal(
    sql("select internal.event_duplicate_text(U&'  CAFE\\0301\\00A0  Programme  ');"),
    "café programme"
  );
  const clients = new Map(),
    http = new Map(),
    timed = createTimeoutFetch();
  for (const user of [owner, other]) {
    const requests = [];
    http.set(user.id, requests);
    clients.set(
      user.id,
      createFoundationAuthenticatedApi(connection, user.token, async (request, init) => {
        const response = await timed(request, init),
          url = new URL(
            typeof request === "string"
              ? request
              : request instanceof URL
                ? request.href
                : request.url
          );
        if (url.pathname === "/rest/v1/rpc/submit_post") {
          const body = response.ok ? null : await response.clone().json();
          requests.push({
            status: response.status,
            code: body?.code ?? null,
            details: body?.details ?? null,
          });
        }
        return response;
      })
    );
  }
  const call = async (user, name, args, service = false) => {
    const result = await rpc(name, args, service ? null : user.token, service);
    assert.equal(result.status, 200, "duplicate fixture " + name);
    return result.data;
  };
  const image = async (user, label) => {
    const object = await call(user, "begin_media_upload", { p_kind: "image", p_bytes: 128 });
    const done = await call(
      user,
      "finalize_media",
      {
        p_object_id: object.object_id,
        p_size: 128,
        p_sha256: createHash("sha256")
          .update(prefix + label)
          .digest("hex"),
        p_mime: "image/jpeg",
        p_width: 800,
        p_height: 600,
      },
      true
    );
    assert.equal(done.state, "ready");
    return object.object_id;
  };
  const images = [await image(owner, "one"), await image(owner, "two")],
    otherImage = await image(other, "other");
  const schedule = () => ({
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    ends_at: new Date(Date.now() + 93600000).toISOString(),
    timezone: "US/Eastern",
  });
  const core = (label) => ({
    title: prefix + " Café " + label,
    description:
      "A synthetic programme description for exact event duplicate checks: " + label + ".",
    activity_key: keys[0],
    province_id: "gp",
    city_id: "gp_johannesburg",
    locality_label: null,
    event_window: schedule(),
  });
  const read = (user, id) => readFoundationBusinessEventEditor(clients.get(user.id), { id });
  const content = (data) => ({
    title: data.title,
    description: data.description,
    province_id: data.province_id,
    city_id: data.city_id,
    locality_label: data.locality_label,
  });
  const make = async (user, data, object = images[0]) => {
    const p = await call(user, "create_core_draft", {
      p_kind: "event",
      p_area: "tourism_events",
      p_category_key: "events",
      p_activity_key: data.activity_key,
      p_detail: { ...data.event_window, contact_channels: ["form"] },
    });
    const c = await saveFoundationPostContent(clients.get(user.id), {
      id: p.id,
      kind: "event",
      expected_revision: 1,
      content: content(data),
    });
    await call(user, "set_post_media", {
      p_post_id: p.id,
      p_expected_revision: c.revision,
      p_items: [{ object_id: object, purpose: "cover", position: 0 }],
    });
    return read(user, p.id);
  };
  const submit = (user, p) =>
    submitFoundationPost(clients.get(user.id), { id: p.id, expected_revision: p.revision });
  const rawSubmit = (user, p) =>
    rpc("submit_post", { p_post_id: p.id, p_expected_revision: p.revision }, user.token);
  const moderate = async (user, p, decision = "approve") => {
    const claim = await call(reviewer, "claim_queue_item", { p_subject: "post", p_id: p.id });
    const viewed = await call(reviewer, "staff_review_post", {
      p_post_id: p.id,
      p_claim_generation: claim.claim_generation,
      p_claim_nonce: claim.claim_nonce,
    });
    assert.equal(viewed.revision, p.revision);
    const result = await rpc(
      "moderate_post",
      {
        p_post_id: p.id,
        p_expected_revision: p.revision,
        p_decision: decision,
        p_reason: decision === "reject" ? "Synthetic duplicate fixture correction" : null,
        p_claim_generation: claim.claim_generation,
        p_claim_nonce: claim.claim_nonce,
      },
      reviewer.token
    );
    assert.equal(result.status, 200, "duplicate fixture moderation");
    return read(user, p.edit_of ?? p.id);
  };
  const remove = async (user, id) => {
    const p = await read(user, id);
    if (!p) return;
    if (p.edit_of)
      await call(user, "discard_post_edit", { p_edit_id: p.id, p_expected_revision: p.revision });
    else await call(user, "delete_post", { p_post_id: p.id, p_expected_revision: p.revision });
    assert.equal(await read(user, id), null);
  };
  const clone = async (user, original, data) => {
    const state = await read(user, original.id),
      copy = await call(user, "create_post_edit", {
        p_post_id: original.id,
        p_expected_revision: state.revision,
      });
    const c = await saveFoundationPostContent(clients.get(user.id), {
      id: copy.id,
      kind: "event",
      expected_revision: 1,
      content: content(data),
    });
    await saveFoundationBusinessEventContext(clients.get(user.id), {
      id: copy.id,
      expected_revision: c.revision,
      patch: { activity_key: data.activity_key, event_window: data.event_window },
    });
    return read(user, copy.id);
  };
  const physical = (ids) => {
    const list = ids.map((id) => "'" + id + "'").join(",");
    return sql(
      "select jsonb_build_object(" +
        "'posts',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from private.posts t where id in(" +
        list +
        "))," +
        "'events',(select coalesce(jsonb_agg(to_jsonb(t) order by t.post_id),'[]') from private.event_details t where post_id in(" +
        list +
        "))," +
        "'links',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from private.post_media t where post_id in(" +
        list +
        "))," +
        "'projection',(select coalesce(jsonb_agg(to_jsonb(t) order by t.post_id),'[]') from private.post_search_documents t where post_id in(" +
        list +
        "))," +
        "'claims',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from private.queue_claims t where post_id in(" +
        list +
        "))," +
        "'logs',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from private.moderation_log t where post_id in(" +
        list +
        "))," +
        "'claim_events',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]')::text,'UTF8')),'hex') from private.queue_claim_events t)," +
        "'reports',(select count(*) from private.reports));"
    );
  };
  const denied = async (user, p, ids = [p.id]) => {
    const before = physical(ids),
      financial = captureFoundationFinancialState(sql),
      responses = http.get(user.id),
      index = responses.length;
    await assert.rejects(
      () => submit(user, p),
      /^Error: A matching event is already pending or live on your account; edit that event instead$/
    );
    assert.equal(responses.length, index + 1);
    assert.deepEqual(responses[index], { status: 409, code: "PT409", details: "duplicate_event" });
    assert.equal(physical(ids), before);
    assert.equal(captureFoundationFinancialState(sql), financial);
  };

  stage("duplicate canonical payload and per-account boundary");
  const data = core("canonical"),
    a = await make(owner, data);
  await submit(owner, a);
  const offset = (s) => new Date(Date.parse(s) + 7200000).toISOString().replace(/Z$/, "+02:00");
  const alias = {
    ...data,
    title: ("  " + data.title.toUpperCase().replace("CAFÉ", "CAFE\u0301") + "  ").replaceAll(
      " ",
      "\u00A0"
    ),
    description: data.description.toUpperCase().replaceAll(" ", "\t"),
    event_window: {
      starts_at: offset(data.event_window.starts_at),
      ends_at: offset(data.event_window.ends_at),
      timezone: "America/New_York",
    },
  };
  const b = await make(owner, alias, images[1]);
  await denied(owner, b, [a.id, b.id]);
  const foreign = await make(other, data, otherImage);
  await submit(other, foreign);
  await remove(other, foreign.id);
  await remove(owner, a.id);
  await submit(owner, b);
  await remove(owner, b.id);
  record(
    "native-event-duplicate-canonical-unicode-whitespace-offset-alias-account-and-delete-release"
  );

  stage("duplicate typed locality normalization and distinct locality");
  const manual = { ...core("manual locality"), city_id: null, locality_label: "Midrand Extension" },
    manualFirst = await make(owner, manual);
  await submit(owner, manualFirst);
  const manualAlias = await make(
    owner,
    {
      ...manual,
      locality_label: "  MIDRAND\u00a0  EXTENSION  ",
    },
    images[1]
  );
  await denied(owner, manualAlias, [manualFirst.id, manualAlias.id]);
  const manualDistinct = await make(
    owner,
    { ...manual, locality_label: "Midrand Other Extension" },
    images[1]
  );
  await submit(owner, manualDistinct);
  await remove(owner, manualFirst.id);
  await remove(owner, manualAlias.id);
  await remove(owner, manualDistinct.id);
  record("native-event-duplicate-manual-locality-normalization-and-distinct-locality");

  stage("duplicate meaningful core difference remains allowed");
  const base = core("distinct"),
    original = await make(owner, base);
  await submit(owner, original);
  for (const changes of [
    { description: base.description + " A different venue description." },
    { activity_key: keys[1] },
    {
      event_window: {
        ...base.event_window,
        ends_at: new Date(Date.parse(base.event_window.ends_at) + 1000).toISOString(),
      },
    },
  ]) {
    const p = await make(owner, { ...base, ...changes }, images[1]);
    await submit(owner, p);
    await remove(owner, p.id);
  }
  await remove(owner, original.id);
  record("native-event-duplicate-meaningful-description-activity-and-time-differences-allowed");

  stage("duplicate logical correction and pending proposal reservation");
  const old = core("logical"),
    draft = await make(owner, old);
  await submit(owner, draft);
  const live = await moderate(owner, await read(owner, draft.id));
  // An edit of the same logical event does not conflict with its original.
  const same = await clone(owner, live, old);
  await submit(owner, same);
  await remove(owner, same.id);
  const proposed = {
      ...old,
      event_window: {
        ...old.event_window,
        ends_at: new Date(Date.parse(old.event_window.ends_at) + 3600000).toISOString(),
      },
    },
    copy = await clone(owner, live, proposed);
  await submit(owner, copy);
  const duplicate = await make(owner, proposed, images[1]);
  await denied(owner, duplicate, [live.id, copy.id, duplicate.id]);
  await moderate(owner, await read(owner, copy.id), "reject");
  await submit(owner, duplicate);
  await remove(owner, duplicate.id);
  await remove(owner, copy.id);
  // Pausing an original releases its active identity; re-entry must pass admission.
  const current = await read(owner, live.id);
  await call(owner, "set_post_state", {
    p_post_id: live.id,
    p_expected_revision: current.revision,
    p_action: "pause",
  });
  const replacement = await make(owner, old, images[1]);
  await submit(owner, replacement);
  await denied(owner, await read(owner, live.id), [live.id, replacement.id]);
  await remove(owner, replacement.id);
  const retry = await submit(owner, await read(owner, live.id));
  await moderate(owner, { ...(await read(owner, live.id)), revision: retry.revision });
  const active = await read(owner, live.id);
  await call(owner, "set_post_state", {
    p_post_id: live.id,
    p_expected_revision: active.revision,
    p_action: "archive",
  });
  const archivedReplacement = await make(owner, old, images[1]);
  await submit(owner, archivedReplacement);
  await remove(owner, archivedReplacement.id);
  await remove(owner, live.id);
  record("native-event-duplicate-same-logical-edit-proposal-reject-pause-resubmit-and-archive");

  for (const deadline of ["ends_at", "visible_until"]) {
    stage("duplicate pending proposal releases after independent parent " + deadline);
    const data = core("expired reservation " + deadline);
    data.event_window.starts_at = new Date(Date.now() - 3600000).toISOString();
    const p = await make(owner, data);
    await submit(owner, p);
    const live = await moderate(owner, await read(owner, p.id));
    const proposal = {
      ...data,
      event_window: {
        ...data.event_window,
        ends_at: new Date(Date.parse(data.event_window.ends_at) + 3600000).toISOString(),
      },
    };
    const contender = await make(owner, proposal, images[1]);
    // Privileged clock fixture shortens just one parent deadline; actual clock
    // passage, not a fabricated owner command, releases the reservation.
    // Set it before cloning: original event detail freezes while a copy exists.
    const table = deadline === "ends_at" ? "private.event_details" : "private.posts";
    const key = deadline === "ends_at" ? "post_id" : "id";
    sql(
      "update " +
        table +
        " set " +
        deadline +
        "=date_trunc('milliseconds',clock_timestamp()+interval '20 seconds') where " +
        key +
        "='" +
        live.id +
        "';"
    );
    const copy = await clone(owner, live, proposal);
    await submit(owner, copy);
    await denied(owner, contender, [live.id, copy.id, contender.id]);
    const elapsed = () =>
      sql(
        "select (" +
          deadline +
          "<=clock_timestamp())::text from " +
          table +
          " where " +
          key +
          "='" +
          live.id +
          "';"
      );
    assert.equal(elapsed(), "false");
    for (let tries = 0; elapsed() !== "true"; tries++) {
      assert.ok(tries < 160, "parent deadline did not expire");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const pending = await read(owner, copy.id),
      claim = await call(reviewer, "claim_queue_item", { p_subject: "post", p_id: copy.id });
    await call(reviewer, "staff_review_post", {
      p_post_id: copy.id,
      p_claim_generation: claim.claim_generation,
      p_claim_nonce: claim.claim_nonce,
    });
    const before = physical([live.id, copy.id, contender.id]),
      finances = captureFoundationFinancialState(sql),
      refused = await rpc(
        "moderate_post",
        {
          p_post_id: copy.id,
          p_expected_revision: pending.revision,
          p_decision: "approve",
          p_reason: null,
          p_claim_generation: claim.claim_generation,
          p_claim_nonce: claim.claim_nonce,
        },
        reviewer.token
      );
    assert.equal(refused.status, 409);
    assert.equal(refused.data.code, "PT409");
    assert.match(
      refused.data.message,
      /funding or event window has ended|original or proposed event window has ended/
    );
    assert.equal(physical([live.id, copy.id, contender.id]), before);
    assert.equal(captureFoundationFinancialState(sql), finances);
    await submit(owner, contender);
    await remove(owner, contender.id);
    await remove(owner, copy.id);
    await remove(owner, live.id);
    record(
      "native-event-duplicate-pending-proposal-parent-" + deadline + "-clock-release-no-revival"
    );
  }

  stage("duplicate per-account ten retained originals rolling allowance and deletion");
  const retained = [];
  for (let index = 0; index < 10; index++) {
    const p = await make(owner, core("monthly " + index));
    await submit(owner, p);
    await moderate(owner, await read(owner, p.id), "reject");
    retained.push(p.id);
  }
  const counted = () =>
    Number(
      sql(
        "select count(*) from private.posts where owner_id='" +
          owner.id +
          "' and kind='event' and edit_of is null and submitted_at>statement_timestamp()-interval '30 days';"
      )
    );
  assert.equal(counted(), 10);
  const extra = await make(owner, core("monthly eleventh"));
  const quotaDenied = async () => {
    const before = physical([...retained, extra.id]),
      financial = captureFoundationFinancialState(sql),
      responses = http.get(owner.id),
      index = responses.length;
    await assert.rejects(
      () => submit(owner, extra),
      /^Error: Foundation posting allowance reached$/
    );
    assert.equal(responses.length, index + 1);
    assert.deepEqual(responses[index], { status: 429, code: "PT429", details: null });
    assert.equal(physical([...retained, extra.id]), before);
    assert.equal(captureFoundationFinancialState(sql), financial);
  };
  await quotaDenied();
  const another = await make(other, core("other account allowance"), otherImage);
  await submit(other, another);
  await remove(other, another.id);
  // Correct/resubmit the same retained identity without an extra logical post.
  const correction = await read(owner, retained[0]);
  await submit(owner, correction);
  await moderate(owner, await read(owner, correction.id), "reject");
  assert.equal(counted(), 10);
  await quotaDenied();
  await remove(owner, retained[0]);
  assert.equal(counted(), 9);
  await submit(owner, extra);
  assert.equal(counted(), 10);
  // Explicit privileged aging proves the rolling boundary independently of deletion.
  sql(
    "update private.posts set submitted_at=statement_timestamp()-interval '31 days' where id='" +
      retained[1] +
      "';"
  );
  assert.equal(counted(), 9);
  const agedReplacement = await make(owner, core("monthly rolling replacement"));
  await submit(owner, agedReplacement);
  assert.equal(counted(), 10);
  for (const id of [...retained, extra.id, agedReplacement.id]) await remove(owner, id);
  record(
    "native-event-duplicate-ten-per-account-retained-originals-correction-delete-and-rolling-release"
  );

  if (controlledSql && awaitQueuedRpc) {
    const race = async (label, kind) => {
      stage("duplicate confirmed owner fence race " + label);
      const proposed = core(label),
        parents = [],
        entries = [];
      if (kind === "original") {
        entries.push(
          await make(owner, proposed, images[0]),
          await make(owner, proposed, images[1])
        );
      } else {
        for (let index = 0; index < (kind === "edit-edit" ? 2 : 1); index++) {
          const initial = core(label + " old " + index),
            p = await make(owner, initial, images[index]);
          await submit(owner, p);
          const live = await moderate(owner, await read(owner, p.id));
          parents.push(live.id);
          entries.push(await clone(owner, live, proposed));
        }
        if (kind === "edit-original") entries.push(await make(owner, proposed, images[1]));
      }
      const beforeParents = parents.length ? physical(parents) : null,
        financial = captureFoundationFinancialState(sql);
      const lock = controlledSql(
        "begin; select pg_advisory_xact_lock(hashtextextended('" +
          owner.id +
          "',909)); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(4); commit;"
      );
      let requests;
      try {
        await lock.barrier;
        requests = entries.map((p) =>
          rawSubmit(owner, p).then(
            (result) => ({ result }),
            (error) => ({ error })
          )
        );
        await awaitQueuedRpc("submit_post", 2);
        assert.equal(await lock.done, 0);
        const outcomes = await Promise.all(requests);
        for (const outcome of outcomes) if (outcome.error) throw outcome.error;
        const results = outcomes.map((o) => o.result);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        const loser = results.find((r) => r.status === 409);
        assert.equal(loser.data.code, "PT409");
        assert.equal(loser.data.details, "duplicate_event");
        for (let index = 0; index < entries.length; index++) {
          const state = await read(owner, entries[index].id);
          assert.equal(
            state.revision,
            entries[index].revision + (results[index].status === 200 ? 1 : 0)
          );
          assert.equal(
            state.status,
            results[index].status === 200 ? "pending_moderation" : "draft"
          );
        }
        if (parents.length) assert.equal(physical(parents), beforeParents);
        assert.equal(captureFoundationFinancialState(sql), financial);
      } finally {
        lock.close();
        await lock.done;
        if (requests) await Promise.all(requests);
      }
      for (const p of entries) await remove(owner, p.id);
      for (const id of parents) await remove(owner, id);
      record(
        "native-event-duplicate-concurrent-" + label + "-one-admission-no-parent-or-financial-write"
      );
    };
    await race("original-original", "original");
    await race("edit-original", "edit-original");
    await race("edit-edit", "edit-edit");

    for (const kind of ["original", "edit"]) {
      stage("duplicate " + kind + " conflict fence wait rechecks actual session before committing");
      const wanted = core("expiry " + kind),
        related = [];
      let p;
      if (kind === "original") {
        const first = await make(owner, wanted);
        await submit(owner, first);
        related.push(first.id);
        p = await make(owner, wanted, images[1]);
      } else {
        const first = await make(owner, core("expiry original"));
        await submit(owner, first);
        const live = await moderate(owner, await read(owner, first.id));
        related.push(live.id);
        p = await clone(owner, live, wanted);
        const competing = await make(owner, wanted, images[1]);
        await submit(owner, competing);
        related.push(competing.id);
      }
      const claims = JSON.parse(Buffer.from(owner.token.split(".")[1], "base64url"));
      const prior = sql(
        "select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='" +
          claims.session_id +
          "' and user_id='" +
          owner.id +
          "';"
      );
      assert.ok(prior);
      const before = physical([p.id, ...related]),
        responses = http.get(owner.id),
        index = responses.length;
      const lock = controlledSql(
        "begin; select pg_advisory_xact_lock(hashtextextended('" +
          owner.id +
          "',909)); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(4); commit;"
      );
      let saving;
      try {
        await lock.barrier;
        saving = submit(owner, p).then(
          (value) => ({ value }),
          (error) => ({ error: error.message })
        );
        await awaitQueuedRpc("submit_post");
        sql(
          "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" +
            claims.session_id +
            "' and user_id='" +
            owner.id +
            "';"
        );
        assert.equal(await lock.done, 0);
        assert.deepEqual(await saving, { error: "Foundation post submission unavailable" });
        assert.equal(responses.length, index + 1);
        assert.deepEqual(responses[index], { status: 403, code: "42501", details: null });
        assert.equal(physical([p.id, ...related]), before);
      } finally {
        lock.close();
        await lock.done;
        if (saving) await saving;
        sql(
          "update auth.sessions set not_after=" +
            prior +
            " where id='" +
            claims.session_id +
            "' and user_id='" +
            owner.id +
            "';"
        );
      }
      await remove(owner, p.id);
      for (const id of related) await remove(owner, id);
      record(
        "native-event-duplicate-" + kind + "-session-expires-during-fence-conflict-exact-rollback"
      );
    }
  }
  stage("duplicate approval refuses explicitly seeded historical conflicting pending data");
  const admission = core("historical"),
    one = await make(owner, admission),
    two = await make(owner, core("other historical"), images[1]);
  await submit(owner, one);
  await submit(owner, two);
  // Privileged historical-data setup, not an owner mutation or admission proof.
  sql(
    "update private.posts b set title=a.title,description=a.description,activity_key=a.activity_key,province_id=a.province_id,city_id=a.city_id,locality_label=a.locality_label from private.posts a where a.id='" +
      one.id +
      "' and b.id='" +
      two.id +
      "'; update private.event_details b set starts_at=a.starts_at,ends_at=a.ends_at,timezone=a.timezone from private.event_details a where a.post_id='" +
      one.id +
      "' and b.post_id='" +
      two.id +
      "';"
  );
  const pending = await read(owner, two.id),
    claim = await call(reviewer, "claim_queue_item", { p_subject: "post", p_id: two.id });
  const viewed = await call(reviewer, "staff_review_post", {
    p_post_id: two.id,
    p_claim_generation: claim.claim_generation,
    p_claim_nonce: claim.claim_nonce,
  });
  assert.equal(viewed.revision, pending.revision);
  const approve = () =>
    rpc(
      "moderate_post",
      {
        p_post_id: two.id,
        p_expected_revision: pending.revision,
        p_decision: "approve",
        p_reason: null,
        p_claim_generation: claim.claim_generation,
        p_claim_nonce: claim.claim_nonce,
      },
      reviewer.token
    );
  let before = physical([one.id, two.id]),
    result = await approve();
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "PT409");
  assert.equal(result.data.details, "duplicate_event");
  assert.equal(physical([one.id, two.id]), before);
  if (controlledSql && awaitQueuedRpc) {
    const staffClaims = JSON.parse(Buffer.from(reviewer.token.split(".")[1], "base64url"));
    const prior = sql(
      "select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='" +
        staffClaims.session_id +
        "' and user_id='" +
        reviewer.id +
        "';"
    );
    assert.ok(prior);
    const lock = controlledSql(
      "begin; select pg_advisory_xact_lock(hashtextextended('" +
        owner.id +
        "',909)); select 'EVIDENCE_LOCK_HELD'; select pg_sleep(4); commit;"
    );
    let reviewing;
    try {
      await lock.barrier;
      reviewing = approve().then(
        (result) => ({ result }),
        (error) => ({ error })
      );
      await awaitQueuedRpc("moderate_post");
      sql(
        "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" +
          staffClaims.session_id +
          "' and user_id='" +
          reviewer.id +
          "';"
      );
      assert.equal(await lock.done, 0);
      const outcome = await reviewing;
      if (outcome.error) throw outcome.error;
      assert.equal(outcome.result.status, 403);
      assert.equal(outcome.result.data.code, "42501");
      assert.equal(physical([one.id, two.id]), before);
    } finally {
      lock.close();
      await lock.done;
      if (reviewing) await reviewing;
      sql(
        "update auth.sessions set not_after=" +
          prior +
          " where id='" +
          staffClaims.session_id +
          "' and user_id='" +
          reviewer.id +
          "';"
      );
    }
  }
  await remove(owner, two.id);
  await remove(owner, one.id);
  record("native-event-duplicate-historical-approval-and-staff-fence-expiry-rollback-no-flags");
}
