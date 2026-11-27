#!/usr/bin/env node
// Behaviour checks for 20261127114113_video_upload_facts.sql (video plan,
// phase 1a; launch checklist item 86): the upload server stores what it read
// from each video's headers (codec, profile, level, size, frame rate,
// faststart, audio, the keep rule it broke) with the video.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks. Before the update
// it completes a video upload with the 5-argument command (no facts). It checks
// the read-only preflight, a drifted body and a premature rollback, applies the
// update and proves apply -> rollback -> apply, then checks: the grants; a call
// with five named arguments (the live website's call) still completes a video;
// facts are stored once, a replay may add them to a video completed without
// them and never changes them; malformed facts and facts on a picture are
// refused; nobody can change stored facts directly.
//
//   node --import tsx scripts/test-foundation-video-upload-facts.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { executeGrants } from "./lib/foundation-sql-checks.mjs";
import {
  applyAndProveRollback,
  checkPreflightBeforeApply,
  functionBodyMd5,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261127114113_video_upload_facts.sql";
const GUARD = "internal.media_object_transition_guard()";
const OLD_INTERNAL = "internal.complete_frontend_video_upload(uuid,integer,text,text,integer)";
const OLD_API = "api.complete_frontend_video_upload(uuid,integer,text,text,integer)";
const NEW_INTERNAL =
  "internal.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb)";
const NEW_API = "api.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb)";
const REVIEWED = {
  [GUARD]: "c0354cb254c330c832d03ba5fdda2242",
  [OLD_INTERNAL]: "316d5afbd7c6c99b0f8f60ac1a739f6a",
  [OLD_API]: "b770d07810330de458f9d09728ed3b38",
};
const UPDATED = {
  [GUARD]: "e3add64969ae482cc7a65f147ecbcf42",
  [NEW_INTERNAL]: "253bc5ca5f4c9f8d85484e9a8bdfb7b7",
  [NEW_API]: "d53810773255ee21eb7e1f09325eeec7",
};
const LABEL = "video upload facts";
const NOT_APPLIED = /^video upload facts: update not applied; videos stored: \d+$/;
const APPLIED = /^video upload facts: already applied; videos stored: \d+; with facts: \d+$/;
const FACTS = {
  codec: "avc1",
  profile: 100,
  level: 40,
  width: 1080,
  height: 1920,
  fps: 29.97,
  faststart: true,
  audio: "aac",
  problem: null,
};

const SETUP = { update: UPDATE, label: "vfacts", title: "Video upload facts" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world, admin } = run;
  const { q, json, fails, member, service, preflight } = kit;
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
  const seller = world.verified("vfacts-seller", admin);

  // A real content-bound upload: the member reserves, the server completes.
  let digestSeed = 0;
  const reserve = (kind = "video", bytes = 4096) => {
    const digest = createHash("sha256").update(`vfacts-${digestSeed++}`).digest("hex");
    const r = json(
      member(seller, `select api.reserve_frontend_media_upload('${kind}',${bytes},'${digest}');`)
    );
    return { id: r.object_id, digest, bytes };
  };
  const literal = (facts) => `'${JSON.stringify(facts).replaceAll("'", "''")}'::jsonb`;
  /** The live website's call: five named arguments, as PostgREST sends them. */
  const completeNamed = (u, ms = 30_000, mime = "video/mp4") =>
    service(
      `select api.complete_frontend_video_upload(p_object_id=>'${u.id}',p_size=>${u.bytes},p_sha256=>'${u.digest}',p_mime=>'${mime}',p_duration_ms=>${ms});`
    );
  const completeWithFacts = (u, facts, ms = 30_000, mime = "video/mp4") =>
    service(
      `select api.complete_frontend_video_upload(p_object_id=>'${u.id}',p_size=>${u.bytes},p_sha256=>'${u.digest}',p_mime=>'${mime}',p_duration_ms=>${ms},p_facts=>${facts === null ? "null" : literal(facts)});`
    );
  const stored = (id) =>
    json(
      `select jsonb_build_object('state',state,'duration_ms',duration_ms,'video_facts',to_jsonb(m)->'video_facts') from private.media_objects m where id='${id}';`
    );

  // ------------------------------------------------------------ before
  let before;
  await check("before the update: a video completes with five arguments and no facts", () => {
    for (const [signature, md5] of Object.entries(REVIEWED)) assert.equal(bodyMd5(signature), md5);
    before = reserve();
    assert.deepEqual(json(completeNamed(before)), { object_id: before.id, state: "ready" });
    assert.deepEqual(stored(before.id), { state: "ready", duration_ms: 30_000, video_facts: null });
  });
  await checkPreflightBeforeApply(kit, database, check, {
    label: LABEL,
    signatures: Object.keys(REVIEWED),
    notApplied: NOT_APPLIED,
    rows: 2,
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: LABEL,
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  // ------------------------------------------------------------- after
  await check("only the upload server completes a video; the 5-argument versions are gone", () => {
    for (const [signature, md5] of Object.entries(UPDATED)) assert.equal(bodyMd5(signature), md5);
    for (const signature of [OLD_INTERNAL, OLD_API])
      assert.equal(q(`select to_regprocedure('${signature}') is null;`), "t", signature);
    assert.deepEqual(executeGrants(json, [NEW_API]), {
      [NEW_API]: { anon: false, authenticated: false, service_role: true },
    });
    for (const role of ["anon", "authenticated"])
      assert.equal(
        q(`select has_function_privilege('${role}','${NEW_INTERNAL}','execute');`),
        "f",
        role
      );
    const u = reserve();
    fails(
      member(
        seller,
        `select api.complete_frontend_video_upload('${u.id}',${u.bytes},'${u.digest}','video/mp4',1000,${literal(FACTS)});`
      ),
      "42501"
    );
  });

  await check("the live website's call (five named arguments) still completes a video", () => {
    const u = reserve();
    assert.deepEqual(json(completeNamed(u, 45_000)), { object_id: u.id, state: "ready" });
    assert.deepEqual(stored(u.id), { state: "ready", duration_ms: 45_000, video_facts: null });
    assert.deepEqual(json(completeNamed(u, 45_000)), { object_id: u.id, state: "ready" });
  });

  await check(
    "facts are stored once; a replay keeps them, a different replay changes nothing",
    () => {
      const u = reserve();
      assert.deepEqual(json(completeWithFacts(u, FACTS)), { object_id: u.id, state: "ready" });
      assert.deepEqual(stored(u.id), { state: "ready", duration_ms: 30_000, video_facts: FACTS });
      assert.deepEqual(json(completeWithFacts(u, FACTS)), { object_id: u.id, state: "ready" });
      const other = { ...FACTS, width: 720, problem: "video_size" };
      assert.deepEqual(json(completeWithFacts(u, other)), { object_id: u.id, state: "ready" });
      assert.deepEqual(json(completeNamed(u)), { object_id: u.id, state: "ready" });
      assert.deepEqual(stored(u.id).video_facts, FACTS);
      fails(completeWithFacts(u, FACTS, 31_000), "PT409", /upload completion changed/);
    }
  );

  await check(
    "a replay adds facts to a video completed without them, also one from before the update",
    () => {
      const u = reserve();
      json(completeNamed(u));
      assert.equal(stored(u.id).video_facts, null);
      json(completeWithFacts(u, FACTS));
      assert.deepEqual(stored(u.id).video_facts, FACTS);
      json(completeWithFacts(before, { ...FACTS, source: "kept" }));
      assert.deepEqual(stored(before.id), {
        state: "ready",
        duration_ms: 30_000,
        video_facts: { ...FACTS, source: "kept" },
      });
    }
  );

  await check("malformed facts are refused before anything is stored", () => {
    const u = reserve();
    for (const facts of [
      [1, 2],
      "avc1",
      { ...FACTS, colour: "hdr" },
      { ...FACTS, width: "1080" },
      { ...FACTS, width: 1080.5 },
      { ...FACTS, width: 20001 },
      { ...FACTS, level: -1 },
      { ...FACTS, fps: 1001 },
      { ...FACTS, fps: "30" },
      { ...FACTS, faststart: "yes" },
      { ...FACTS, codec: "" },
      { ...FACTS, codec: "avc1avc1a" },
      { ...FACTS, audio: null },
      { ...FACTS, problem: 3 },
      { ...FACTS, problem: "x".repeat(21) },
      { ...FACTS, source: "edited" },
    ])
      assert.match(
        fails(completeWithFacts(u, facts), "22023"),
        /video_facts_invalid/,
        JSON.stringify(facts)
      );
    assert.deepEqual(stored(u.id), { state: "intent", duration_ms: null, video_facts: null });
    for (const source of ["kept", "remuxed", "converted"])
      assert.deepEqual(json(completeWithFacts(reserve(), { ...FACTS, source })).state, "ready");
    const picture = reserve("image");
    fails(
      completeWithFacts(picture, FACTS, 10_000, "image/jpeg"),
      "22023",
      /video upload required/
    );
  });

  await check("stored facts never change, and only videos carry them", () => {
    const u = reserve();
    json(completeWithFacts(u, FACTS));
    fails(
      `update private.media_objects set video_facts='{"codec":"hvc1"}' where id='${u.id}';`,
      "23514",
      /video facts are immutable/
    );
    fails(
      `update private.media_objects set video_facts=null where id='${u.id}';`,
      "23514",
      /video facts are immutable/
    );
    const picture = reserve("image");
    fails(
      `update private.media_objects set video_facts='{}' where id='${picture.id}';`,
      "23514",
      /media_objects_video_facts_check/
    );
    const plain = reserve();
    json(completeNamed(plain));
    fails(
      `update private.media_objects set video_facts='[]' where id='${plain.id}';`,
      "23514",
      /media_objects_video_facts_check/
    );
  });

  await check("preflight after the update: applied, with the facts counted", () => {
    const [summary, ...problems] = preflight();
    assert.deepEqual(problems, []);
    assert.match(summary[1], APPLIED);
    assert.match(summary[1], /with facts: [1-9]\d*$/);
  });
});
