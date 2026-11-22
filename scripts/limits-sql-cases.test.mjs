// Database limits from docs/testing/limits-register.json on claimed ID and
// business (CIPC and seen) cases, the ID upload steps and the automatic ID
// check settings. Each is driven to its bound through the real function on
// the replayed production schema (embedded Postgres, no Docker, no hosted
// database), and the next step is shown refused.
//
// Fixtures (scripts/lib/limits-sql-fixtures.mjs): an ID case held by a staff
// member with its submission, an open business check (CIPC or seen) of a
// business, claimed or assigned to a staff member, with its files.
//
//   node --import tsx --test scripts/limits-sql-cases.test.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { lit, openLimitsDb, refused } from "./lib/limits-sql-harness.mjs";
import {
  businessCase,
  businessPost,
  heldIdentityCase,
  caseArtifacts,
  digest,
  fingerprintSql,
  json,
  verifiedMember,
} from "./lib/limits-sql-fixtures.mjs";

let h;
before(async () => {
  h = await openLimitsDb();
});
after(async () => {
  await h?.db.close();
});

/** Resolves when `promise` passes the guard: it succeeds, or fails with an error matching `then`. */
async function passes(promise, guard, then) {
  try {
    return await promise;
  } catch (error) {
    assert.doesNotMatch(error.message, guard, "refused by the guard");
    if (!then) throw error;
    assert.match(error.message, then);
    return undefined;
  }
}

/** `object` with `key` padded so that its jsonb text is exactly `bytes` long. */
async function padded(object, key, bytes) {
  const base = Number(
    await h.one(`select octet_length($1::jsonb::text)`, [JSON.stringify({ ...object, [key]: "" })])
  );
  const value = { ...object, [key]: "a".repeat(bytes - base) };
  assert.equal(
    Number(await h.one(`select octet_length($1::jsonb::text)`, [JSON.stringify(value)])),
    bytes
  );
  return value;
}

// ---------------------------------------------------------------- ID cases

const approveStep = (reviewer, c, artifact, { note = null, override = null } = {}) =>
  h.asStaff(
    reviewer,
    `select api.approve_frontend_identity_step(${lit(c.case)},${lit(c.submission)},${lit(artifact)},1,'1',${lit(c.nonce)},true,
      ${note === null ? "null" : lit(note)},${override === null ? "null" : lit(override)}) as r`
  );

describe("ID cases", () => {
  test("LIM-F-approve_frontend_identity_step: above risk 50 the reviewer must also be able to propose decisions", async () => {
    const moderator = await h.staff("step-moderator", "moderator");
    const low = await heldIdentityCase(h, moderator, 50);
    assert.equal((await approveStep(moderator, low, low.idPhoto))[0].r.status, "step_approved");
    const high = await heldIdentityCase(h, moderator, 51);
    await refused(
      approveStep(moderator, high, high.idPhoto, { override: "fixture_override" }),
      "42501",
      /capability not granted/
    );
  });

  test("LIM-F-approve_frontend_identity_step-2: a reviewer note is 1 to 2,000 characters", async () => {
    const admin = await h.staff("step-note");
    const c = await heldIdentityCase(h, admin, 0);
    await approveStep(admin, c, c.idPhoto, { note: "n".repeat(2000) });
    const d = await heldIdentityCase(h, admin, 0);
    await approveStep(admin, d, d.idPhoto, { note: "n" });
    for (const note of ["n".repeat(2001), "   "]) {
      const e = await heldIdentityCase(h, admin, 0);
      await refused(
        approveStep(admin, e, e.idPhoto, { note }),
        "22023",
        /valid reviewer note required/
      );
    }
  });

  test("LIM-F-approve_frontend_identity_step-3: above risk 50 a review reason is required", async () => {
    const admin = await h.staff("step-reason");
    const at = await heldIdentityCase(h, admin, 50);
    await approveStep(admin, at, at.idPhoto);
    const over = await heldIdentityCase(h, admin, 51);
    await refused(
      approveStep(admin, over, over.idPhoto),
      "22023",
      /high-risk review reason required/
    );
    await approveStep(admin, over, over.idPhoto, { override: "fixture_override" });
  });

  test("LIM-F-review_identity_submission: above risk 50 a second reviewer decides", async () => {
    const admin = await h.staff("review-risk");
    const review = (c) =>
      h.asStaff(
        admin,
        `select api.review_identity_submission(${lit(c.submission)},1,'1',${lit(c.nonce)},true,true) as r`
      );
    assert.equal((await review(await heldIdentityCase(h, admin, 50)))[0].r.status, "accepted");
    assert.equal(
      (await review(await heldIdentityCase(h, admin, 51)))[0].r.status,
      "awaiting_second_reviewer"
    );
  });

  test("LIM-F-complete_frontend_verification_upload: the server's risk score is 0 to 100", async () => {
    // A selfie upload waiting to finish after its completed ID photo.
    const upload = async (label) => {
      const owner = await h.member(`selfie-${label}`);
      const c = randomUUID();
      const idArtifact = randomUUID();
      const selfie = randomUUID();
      const idRequest = randomUUID();
      const request = randomUUID();
      await h.seed(`
        insert into private.evidence_cases(id,subject_id,kind) values(${lit(c)},${lit(owner.id)},'kyc');
        insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,sha256,content_sha256) values
          (${lit(idArtifact)},${lit(c)},${lit(owner.id)},'id_front','evidence/'||gen_random_uuid(),'clean',${lit(digest("i"))},${lit(digest("i"))}),
          (${lit(selfie)},${lit(c)},${lit(owner.id)},'selfie','evidence/'||gen_random_uuid(),'intent',null,null);
        insert into private.frontend_verification_uploads(owner_id,request_id,session_id,case_id,case_version,purpose,request_digest,artifact_id,
            fingerprint,encrypted_number,completed_at)
          values(${lit(owner.id)},${lit(idRequest)},${lit(owner.session)},${lit(c)},1,'id_front',${lit(digest("i"))},${lit(idArtifact)},
            ${fingerprintSql(owner.id)},${json({ ciphertext: "a".repeat(26), iv: "b".repeat(24), tag: "c".repeat(32), key_id: "identity-number-v1" })},now());
        insert into private.frontend_verification_uploads(owner_id,request_id,session_id,case_id,case_version,purpose,request_digest,artifact_id,
            id_request,capture_method,browser_liveness_passed)
          values(${lit(owner.id)},${lit(request)},${lit(owner.session)},${lit(c)},1,'selfie',${lit(digest("s"))},${lit(selfie)},${lit(idRequest)},'camera',true);`);
      return { owner, request };
    };
    const complete = async (risk) => {
      const u = await upload(risk);
      return h.asService(
        `select api.complete_frontend_verification_upload(${lit(u.owner.id)},${lit(u.request)},${lit(digest("s"))},${lit(digest("s"))},1024,null,${risk}) as r`
      );
    };
    // The guard lets 0 and 100 through: the selfie is stored, and the
    // submission then stops at the member's missing legal name.
    for (const risk of [0, 100])
      await passes(
        complete(risk),
        /server assessment required/,
        /legal name required before identity submission/
      );
    for (const risk of [-1, 101])
      await refused(complete(risk), "22023", /server assessment required/);
  });

  test("LIM-F-reserve_handoff_verification_upload: at most 5 unfinished uploads a case", async () => {
    const owner = await h.member("handoff-uploads");
    const c = randomUUID();
    const grant = digest(`grant-${owner.id}`);
    await h.seed(`
      insert into private.evidence_cases(id,subject_id,kind) values(${lit(c)},${lit(owner.id)},'kyc');
      insert into private.capture_handoffs(token_sha256,owner_id,case_id,session_id,created_at,expires_at,used_at,grant_sha256,expects_id,fingerprint,encrypted_number)
        values(${lit(digest(`token-${owner.id}`))},${lit(owner.id)},${lit(c)},${lit(owner.session)},now(),now()+interval '15 minutes',now(),${lit(grant)},true,
          ${fingerprintSql(owner.id)},${json({ ciphertext: "a".repeat(26), iv: "b".repeat(24), tag: "c".repeat(32), key_id: "identity-number-v1" })});
      insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
        select ${lit(c)},${lit(owner.id)},'id_front','evidence/'||gen_random_uuid() from generate_series(1,4);`);
    const reserve = (n) =>
      h.asService(
        `select api.reserve_handoff_verification_upload(${lit(grant)},${lit(owner.id)},${lit(randomUUID())},'id_front',${lit(digest(`up-${n}`))}) as r`
      );
    await reserve(5);
    await refused(reserve(6), "PT429", /too many unfinished uploads/);
  });
});

// ---------------------------------------------------------------- business cases

/** A business owner whose ID review is accepted, with a live business. */
async function businessOwner(label) {
  const owner = await verifiedMember(h, label);
  return { owner, business: await businessPost(h, owner) };
}

describe("CIPC cases", () => {
  test("LIM-F-correct_frontend_cipc_office and -2: a corrected office is at most 6,000 bytes and 3 street lines", async () => {
    const admin = await h.staff("office-staff");
    const correct = async (office) => {
      const { owner, business } = await businessOwner("office-owner");
      const c = await businessCase(h, owner, business, { kind: "cipc", claimedBy: admin });
      return h.asStaff(
        admin,
        `select api.correct_frontend_cipc_office(${lit(c.id)},${lit(c.updatedAt)},'1',${lit(c.nonce)},${json(office)}) as r`
      );
    };
    const office = { province: "Gauteng", city: "Johannesburg", streetLines: ["1 Fixture Street"] };
    // LIM-F-correct_frontend_cipc_office: 6,000 bytes pass the size rule (the
    // padded suburb is then too long for its own rule); 6,001 do not.
    await passes(
      correct(await padded(office, "suburb", 6000)),
      /valid registered office required/,
      /check the request text/
    );
    await refused(
      correct(await padded(office, "suburb", 6001)),
      "22023",
      /valid registered office required/
    );
    // LIM-F-correct_frontend_cipc_office-2: 3 street lines, not 4.
    await correct({ ...office, streetLines: ["1 Street", "Block A", "Unit 3"] });
    await refused(
      correct({ ...office, streetLines: ["1", "2", "3", "4"] }),
      "22023",
      /valid registered office required/
    );
  });

  test("LIM-F-record_frontend_cipc_callback: a callback record is at most 10,000 bytes", async () => {
    const admin = await h.staff("callback-staff");
    const record = async (callback) => {
      const { owner, business } = await businessOwner("callback-owner");
      const c = await businessCase(h, owner, business, {
        kind: "cipc",
        route: "representative",
        claimedBy: admin,
      });
      return h.asStaff(
        admin,
        `select api.record_frontend_cipc_callback(${lit(c.id)},${lit(c.updatedAt)},'1',${lit(c.nonce)},true,${json(callback)}) as r`
      );
    };
    const callback = {
      numberSource: "Company website",
      spokeTo: "Fixture Person",
      confirmedPosition: "Director",
      confirmed: true,
    };
    await passes(
      record(await padded(callback, "notes", 10000)),
      /valid callback record required/,
      /check the request text/
    );
    await refused(
      record(await padded(callback, "notes", 10001)),
      "22023",
      /valid callback record required/
    );
  });

  test("LIM-F-reserve_frontend_cipc_document: at most 10 owner uploads a CIPC case", async () => {
    const { owner, business } = await businessOwner("cipc-uploads");
    const c = await businessCase(h, owner, business, { kind: "cipc", submitted: false });
    await h.seed(
      `${caseArtifacts(
        c.id,
        owner,
        9,
        "registration",
        `insert into private.frontend_cipc_documents(artifact_id,check_id,actor_id,source,content_digest,reviewed_version)
       select id,${lit(c.id)},${lit(owner.id)},'owner_upload',content_sha256,now() from a;`
      )}`
    );
    const reserve = (n) =>
      h.asMember(
        owner,
        `select api.reserve_frontend_cipc_document(${lit(business)},'2020/123456/07','director',false,${lit(digest(`cipc-${n}`))}) as r`
      );
    await reserve(10);
    await refused(reserve(11), "PT429", /CIPC attachment limit reached/);
  });

  test("LIM-F-reserve_frontend_cipc_official: at most 10 official copies a CIPC case", async () => {
    const admin = await h.staff("official-staff");
    const { owner, business } = await businessOwner("official-owner");
    const c = await businessCase(h, owner, business, { kind: "cipc", claimedBy: admin });
    await h.seed(
      caseArtifacts(
        c.id,
        owner,
        9,
        "registration",
        `insert into private.frontend_cipc_documents(artifact_id,check_id,actor_id,source,content_digest,reviewed_version,claim_generation,claim_nonce)
       select id,${lit(c.id)},${lit(admin.id)},'admin_copy',content_sha256,now(),'1',${lit(c.nonce)} from a;`
      )
    );
    const reserve = (n) =>
      h.asStaff(
        admin,
        `select api.reserve_frontend_cipc_official(${lit(c.id)},${lit(c.updatedAt)},'1',${lit(c.nonce)},${lit(digest(`official-${n}`))}) as r`
      );
    await reserve(10);
    await refused(reserve(11), "PT429", /official copy attachment limit reached/);
  });

  test("LIM-F-verify_frontend_cipc_email: a work-email code allows 5 tries", async () => {
    const verify = async (attempts, code) => {
      const { owner, business } = await businessOwner(`email-${attempts}`);
      const c = await businessCase(h, owner, business, {
        kind: "cipc",
        route: "representative",
        submitted: false,
      });
      await h.seed(`insert into private.frontend_cipc_email_codes(check_id,digest,expires_at,started_at,sent_at,attempts)
        values(${lit(c.id)},${lit(digest("code"))},now()+interval '10 minutes',now(),now(),${attempts});`);
      return (
        await h.asService(
          `select api.verify_frontend_cipc_email(${lit(owner.id)},${lit(owner.session)},${lit(business)},${lit(c.id)},${lit(digest(code))}) as r`
        )
      )[0].r;
    };
    // After 4 wrong tries the 5th still counts; after 5 even the right code is refused.
    assert.deepEqual(await verify(4, "code"), { verified: true, remaining: 0 });
    assert.deepEqual(await verify(4, "wrong"), { verified: false, remaining: 0 });
    assert.deepEqual(await verify(5, "code"), { verified: false, remaining: 0 });
  });

  test("LIM-F-apply_frontend_registered_office: a registered office street address of 1 to 500 characters is shown", async () => {
    const apply = async (street) => {
      const owner = await h.member("office-apply");
      const business = await businessPost(h, owner);
      await h.asOwner(
        `select internal.apply_frontend_registered_office(${lit(business)},${lit(owner.id)},${json({
          city: "Johannesburg",
          province: "Gauteng",
          streetLines: street ? [street] : [],
        })})`
      );
      return h.one(
        `select data->>'location_address' from private.post_presentations where post_id=$1`,
        [business]
      );
    };
    assert.equal(await apply("a"), "a");
    assert.equal((await apply("a".repeat(500)))?.length, 500);
    assert.equal(await apply("a".repeat(501)), undefined);
    assert.equal(await apply(""), undefined);
  });
});

describe("seen (visit or video) cases", () => {
  /** `count` clean photos of `verifier` on case `c` (fixture). */
  const photos = (c, owner, verifier, count) =>
    h.seed(
      caseArtifacts(
        c.id,
        owner,
        count,
        "business_visit_photo",
        `insert into private.frontend_business_seen_photos(artifact_id,check_id,verifier_id,content_digest,mime)
       select id,${lit(c.id)},${lit(verifier.id)},content_sha256,'image/jpeg' from a;`
      )
    );
  const report = {
    outcome: "seen",
    identityConfirmed: true,
    signage: true,
    productsSeen: "Fresh produce",
    premisesType: "shop",
  };

  test("LIM-F-report_frontend_seen_check: a visit report is at most 8,000 bytes", async () => {
    const verifier = await h.staff("report-size");
    const send = async (value) => {
      const { owner, business } = await businessOwner("report-size-owner");
      const c = await businessCase(h, owner, business, { assignedTo: verifier });
      return h.asStaff(
        verifier,
        `select api.report_frontend_seen_check(${lit(c.id)},${lit(c.updatedAt)},${json(value)}) as r`
      );
    };
    const notSeen = { ...report, outcome: "not_confirmed" };
    await passes(
      send(await padded(notSeen, "notes", 8000)),
      /valid business visit report required/,
      /check the request text/
    );
    await refused(
      send(await padded(notSeen, "notes", 8001)),
      "22023",
      /valid business visit report required/
    );
  });

  test("LIM-F-report_frontend_seen_check-4: a seen report needs 3 confirmed photos", async () => {
    const verifier = await h.staff("report-photos");
    const send = async (count) => {
      const { owner, business } = await businessOwner(`report-photos-${count}`);
      const c = await businessCase(h, owner, business, { assignedTo: verifier });
      await photos(c, owner, verifier, count);
      return h.asStaff(
        verifier,
        `select api.report_frontend_seen_check(${lit(c.id)},${lit(c.updatedAt)},${json(report)}) as r`
      );
    };
    await send(3);
    await refused(send(2), "PT409", /three distinct confirmed photographs required/);
  });

  test("LIM-F-decide_frontend_seen_check-3: approval needs 3 confirmed photos of the reporting verifier", async () => {
    const verifier = await h.staff("decide-verifier");
    const reviewer = await h.staff("decide-reviewer");
    const decide = async (count) => {
      const { owner, business } = await businessOwner(`decide-${count}`);
      const c = await businessCase(h, owner, business, {
        assignedTo: verifier,
        claimedBy: reviewer,
        extra: `update private.frontend_business_checks set report_by=${lit(verifier.id)},report_at=now(),
          visit_report='{"outcome":"seen","identityConfirmed":true}'::jsonb where id=$CASE;`,
      });
      await photos(c, owner, verifier, count);
      return h.asStaff(
        reviewer,
        `select api.decide_frontend_seen_check(${lit(c.id)},${lit(c.updatedAt)},'approve','1',${lit(c.nonce)}) as r`
      );
    };
    assert.equal((await decide(3))[0].r.status, "approved");
    await refused(decide(2), "PT409", /three current photographs required/);
  });

  test("LIM-F-reserve_frontend_seen_photo: at most 12 photos a check", async () => {
    const verifier = await h.staff("seen-photos");
    const { owner, business } = await businessOwner("seen-photos-owner");
    const c = await businessCase(h, owner, business, { assignedTo: verifier });
    await photos(c, owner, verifier, 11);
    const reserve = (n) =>
      h.asStaff(
        verifier,
        `select api.reserve_frontend_seen_photo(${lit(c.id)},${lit(digest(`photo-${n}`))}) as r`
      );
    await reserve(12);
    await refused(reserve(13), "PT429", /visit photo limit reached/);
  });

  test("LIM-F-reserve_frontend_seen_reply_file: at most 20 attachments a check", async () => {
    const { owner, business } = await businessOwner("reply-files");
    const c = await businessCase(h, owner, business);
    await h.seed(
      caseArtifacts(
        c.id,
        owner,
        19,
        "business_reply_attachment",
        `insert into private.frontend_business_reply_files(artifact_id,check_id,content_digest,mime)
       select id,${lit(c.id)},content_sha256,'application/pdf' from a;`
      )
    );
    const reserve = (n) =>
      h.asMember(
        owner,
        `select api.reserve_frontend_seen_reply_file(${lit(business)},${lit(c.id)},${lit(digest(`reply-${n}`))},'application/pdf') as r`
      );
    await reserve(20);
    await refused(reserve(21), "PT429", /attachment limit reached/);
  });
});

describe("business page presentation", () => {
  test("LIM-F-save_frontend_post_presentation: at most 12 presentation images", async () => {
    const owner = await h.member("presentation");
    const business = await businessPost(h, owner);
    const media = Array.from({ length: 13 }, () => randomUUID());
    await h.seed(`insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,state,mime,width,height,size_bytes,sha256)
      select id,${lit(owner.id)},'image','media/'||id,1024,'ready','image/jpeg',100,100,1024,${lit(digest("m"))}
      from unnest(array[${media.map(lit).join(",")}]::uuid[]) id;`);
    const items = media.map((id, n) =>
      n === 0
        ? { object_id: id, purpose: "logo", position: 0 }
        : n === 1
          ? { object_id: id, purpose: "poster", position: 0 }
          : { object_id: id, purpose: "venue", position: n - 2 }
    );
    const save = (list) =>
      h.asOwner(
        `select internal.save_frontend_post_presentation(${lit(business)},'{}'::jsonb,'{}'::jsonb,${json(list)})`
      );
    await save(items.slice(0, 12));
    await refused(save(items), "22023", /post presentation unavailable/);
  });
});

describe("automatic ID check settings", () => {
  test("LIM-F-set_identity_check_mode: a reason of 5 to 500 characters", async () => {
    const admin = await h.staff("check-mode");
    const set = (reason) =>
      h.asStaff(admin, `select api.set_identity_check_mode('manual',${lit(reason)}) as r`);
    for (const reason of ["a".repeat(5), "a".repeat(500)]) await set(reason);
    for (const reason of ["a".repeat(4), "a".repeat(501)])
      await refused(set(reason), "22023", /identity check mode reason required/);
  });

  test("LIM-F-attach_identity_check_session: a session link of at most 500 characters", async () => {
    const attach = (length) => {
      const url = "https://verify.didit.me/";
      return h.asService(
        `select api.attach_identity_check_session(${lit(randomUUID())},${lit(randomUUID())},${lit(url + "a".repeat(length - url.length))},${lit(digest("net"))},'phone')`
      );
    };
    await refused(attach(500), "PT409", /unfinished identity check required/);
    await refused(attach(501), "22023", /identity check session required/);
  });

  test("LIM-F-get_identity_check_settings: the 5 latest mode changes", async () => {
    const admin = await h.staff("check-settings");
    await h.seed(`insert into private.identity_check_mode_events(from_mode,to_mode,changed_by,reason,changed_at)
      select 'manual','staff_final',${lit(admin.id)},'Synthetic mode reason',now()-make_interval(mins=>n) from generate_series(1,6) n;`);
    const changes = (await h.asStaff(admin, `select api.get_identity_check_settings() as r`))[0].r
      .recent_changes;
    assert.equal(changes.length, 5);
  });
});
