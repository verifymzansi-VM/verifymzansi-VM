// Seeds the foundation browser test copy (M0.7) with its test people and
// showroom posts. Everything goes through the real local Auth (GoTrue) and the
// production API commands, except three trusted local-only SQL steps that an
// owner SQL session performs in production too: adding sign-up invitations,
// closing them, and granting the moderator role. No hosted project, SMS
// provider, email provider or payment provider is involved: confirmation
// emails are read from the local mail catcher, phone proofs use the service
// commands the website calls after an SMS code matches.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { processIdentityNumber } from "../../src/lib/domains/verification/identity-processing.ts";
import { validateSaIdChecksum } from "../../src/lib/utils/sa-id-validation.ts";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };
import people from "../../e2e/foundation/fixture/people.json" with { type: "json" };
import postsFixture from "../../e2e/foundation/fixture/posts.json" with { type: "json" };
import { nativeTotp } from "./foundation-native-totp.mjs";
import { E2E_FIXTURE, assertLocalFoundationTarget } from "./foundation-e2e-target.mjs";

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The committed fixture definitions (module imports, not runtime file reads). */
function readFixtureFiles() {
  return { people, posts: postsFixture.posts };
}

/** HTTP helpers for the local gateway only (asserted on every request). */
function localApi(status) {
  const origin = assertLocalFoundationTarget({ apiUrl: status.apiUrl });
  const request = async (pathname, { method = "POST", body, token, service = false } = {}) => {
    const url = new URL(pathname, origin);
    assert.equal(url.origin, origin);
    const response = await fetch(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        apikey: service ? status.secretKey : status.publishableKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
        "Content-Profile": "api",
        "Accept-Profile": "api",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data };
  };
  const rpc = (name, body, token, service = false) =>
    request(`/rest/v1/rpc/${name}`, { body, token, service });
  const call = async (name, body, token, service = false) => {
    const result = await rpc(name, body, token, service);
    if (result.status !== 200)
      throw new Error(
        `Seed command ${name} returned ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`
      );
    return result.data;
  };
  return { origin, request, rpc, call };
}

/** GoTrue password sign-in, then an authenticator step when a factor is given. */
async function signIn(api, { email, password }, factor) {
  const login = await api.request("/auth/v1/token?grant_type=password", {
    body: { email, password },
  });
  if (login.status !== 200) throw new Error(`Sign-in failed (${login.status})`);
  let session = login.data;
  if (factor) session = await verifyTotp(api, session.access_token, factor);
  return { id: session.user.id, token: session.access_token, refreshToken: session.refresh_token };
}

/** One RFC 6238 code (node:crypto, via nativeTotp), waiting for a fresh step
 * when the previous code was just used. */
async function verifyTotp(api, token, factor) {
  const step = Math.floor(Date.now() / 30000);
  if (factor.lastStep === step) await sleep(30000 - (Date.now() % 30000) + 250);
  const challenge = await api.request(`/auth/v1/factors/${factor.id}/challenge`, { token });
  if (challenge.status !== 200) throw new Error(`TOTP challenge failed (${challenge.status})`);
  factor.lastStep = Math.floor(Date.now() / 30000);
  const verified = await api.request(`/auth/v1/factors/${factor.id}/verify`, {
    token,
    body: { challenge_id: challenge.data.id, code: nativeTotp(factor.secret) },
  });
  if (verified.status !== 200) throw new Error(`TOTP verification failed (${verified.status})`);
  return verified.data;
}

/** Reads the newest message to an address from the local mail catcher. The
 * requests carry no fixture data: the fixed local catcher's recent-message list
 * is fetched and filtered here, and only a message id it returned is used. */
const MAIL_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.mailPort}`;
async function latestMail(mailUrl, email, { after = 0, timeoutMs = 20000 } = {}) {
  assert.equal(new URL(mailUrl).origin, MAIL_ORIGIN, "mail catcher must be local");
  const wanted = email.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await fetch(`${MAIL_ORIGIN}/api/v1/messages?limit=50`, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    }).then((response) => response.json());
    const message = (list.messages ?? []).find(
      (item) =>
        Date.parse(item.Created) >= after &&
        (item.To ?? []).some((to) => String(to.Address).toLowerCase() === wanted)
    );
    if (message && /^[A-Za-z0-9]{8,64}$/.test(message.ID)) {
      return fetch(`${MAIL_ORIGIN}/api/v1/message/${message.ID}`, {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      }).then((response) => response.json());
    }
    await sleep(500);
  }
  throw new Error("No email reached the local mail catcher");
}

/** Real sign-up through the invitation gate, confirmed from the mail catcher. */
async function registerThroughInvitation(api, status, person) {
  const sentAfter = Date.now() - 1000;
  const signup = await api.request("/auth/v1/signup", {
    body: { email: person.email, password: person.password },
  });
  if (signup.status !== 200)
    throw new Error(`Sign-up refused for a test person (${signup.status})`);
  const mail = await latestMail(status.mailUrl, person.email, { after: sentAfter });
  const link = String(mail.Text ?? "").match(
    /http:\/\/127\.0\.0\.1:\d+\/auth\/v1\/verify\?[^\s)\]>"]+/
  )?.[0];
  if (!link) throw new Error("The confirmation email has no local confirmation link");
  const confirm = new URL(link.replaceAll("&amp;", "&"));
  assert.equal(confirm.origin, api.origin);
  const response = await fetch(confirm, { redirect: "manual", signal: AbortSignal.timeout(10000) });
  if (![302, 303].includes(response.status)) throw new Error("Email confirmation failed");
  const location = response.headers.get("location") ?? "";
  if (/error/.test(location)) throw new Error("Email confirmation was refused");
}

async function enrolTotp(api, token, label) {
  const enrolled = await api.request("/auth/v1/factors", {
    token,
    body: { factor_type: "totp", friendly_name: `${label} authenticator` },
  });
  if (enrolled.status !== 200) throw new Error(`TOTP enrolment failed (${enrolled.status})`);
  return { id: enrolled.data.id, secret: enrolled.data.totp.secret, lastStep: null };
}

function syntheticIdNumber(sequence) {
  const prefix = "850101" + String(5000 + sequence).padStart(4, "0") + "08";
  for (let digit = 0; digit < 10; digit++)
    if (validateSaIdChecksum(prefix + digit)) return prefix + digit;
  throw new Error("Synthetic identity number unavailable");
}

async function verifyIdentity({ api, sql, owner, reviewer }) {
  const opened = await api.call("open_verification_case", {}, owner.token);
  const caseId = opened.case_id;
  assert.match(caseId, UUID);
  const artifacts = [];
  for (const purpose of ["id_front", "selfie"]) {
    const begun = await api.call(
      "begin_evidence_upload",
      { p_case_id: caseId, p_purpose: purpose },
      owner.token
    );
    artifacts.push(begun.artifact_id);
    // Synthetic object metadata, as the scanner/uploader reports it; no bytes.
    for (const state of ["uploaded", "clean"])
      await api.call(
        "advance_evidence_artifact",
        {
          p_artifact_id: begun.artifact_id,
          p_state: state,
          p_sha256: createHash("sha256")
            .update(owner.id + purpose)
            .digest("hex"),
          p_size: 128,
        },
        null,
        true
      );
  }
  // Throwaway keys: the encrypted number never leaves this local database.
  const processed = processIdentityNumber(owner.id, syntheticIdNumber(1), {
    identityMatchKey: randomBytes(32).toString("hex"),
    numberEncryptionKey: randomBytes(32).toString("hex"),
    identityKeyId: "identity-match-v1",
    encryptionKeyId: "identity-number-v1",
  });
  const version = Number(
    sql(`select version from private.evidence_cases where id=${quote(caseId)};`)
  );
  const submitted = await api.call(
    "register_identity_submission",
    {
      p_case: caseId,
      p_expected_version: version,
      p_id_artifact: artifacts[0],
      p_selfie_artifact: artifacts[1],
      p_fingerprint: processed.fingerprint,
      p_identity_key: processed.identityKeyId,
      p_encrypted_number: processed.encryptedNumber,
      p_receipt: randomUUID(),
      p_risk_score: 10,
    },
    null,
    true
  );
  const lease = await api.call("claim_evidence_case", { p_case_id: caseId }, reviewer.token);
  const reviewed = await api.call(
    "review_identity_submission",
    {
      p_submission: submitted.submission_id,
      p_expected_version: submitted.case_version,
      p_claim_generation: lease.claim_generation,
      p_claim_nonce: lease.claim_nonce,
      p_number_matches: true,
      p_selfie_matches: true,
    },
    reviewer.token
  );
  assert.equal(reviewed.status, "accepted");
}

async function verifyPhone({ api, owner }) {
  // The website stores only a hash of the SMS code; the code never matters here.
  const phone = "+2771" + String(randomInt(1000000, 10000000));
  const hash = randomBytes(32).toString("hex");
  const challenge = await api.call(
    "create_verification_phone_challenge",
    { p_owner: owner.id, p_phone: phone, p_hash: hash },
    null,
    true
  );
  await api.call(
    "claim_verification_phone_attempt",
    { p_owner: owner.id, p_challenge: challenge.challenge_id },
    null,
    true
  );
  const verified = await api.call(
    "finalize_verification_phone",
    { p_owner: owner.id, p_challenge: challenge.challenge_id, p_expected_hash: hash },
    null,
    true
  );
  assert.equal(verified.verified, true);
}

/** A small real JPEG per post, served by the website from the ignored
 * public/e2e-media/media/ folder (the stub suite's local media folder). */
async function coverImage(colour) {
  const bytes = await sharp({
    create: { width: 800, height: 600, channels: 3, background: colour },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function publishPost({ api, root, owner, moderator, spec }) {
  const detail =
    spec.kind === "event"
      ? {
          contact_channels: spec.contactChannels ?? ["form"],
          starts_at: new Date(Date.now() - 60_000).toISOString(),
          ends_at: new Date(Date.now() + spec.durationDays * 86_400_000).toISOString(),
          timezone: "Africa/Johannesburg",
        }
      : {};
  let post = await api.call(
    "create_core_draft",
    {
      p_kind: spec.kind,
      p_area: spec.area,
      p_category_key: spec.categoryKey,
      p_detail: detail,
      ...(spec.kind === "event"
        ? { p_activity_key: reference.activities.find((a) => a.category === spec.categoryKey).key }
        : {}),
    },
    owner.token
  );
  post = await api.call(
    "save_post_content",
    {
      p_post_id: post.id,
      p_expected_revision: post.revision,
      p_content: {
        title: spec.title,
        description: spec.description,
        province_id: spec.provinceId,
        city_id: spec.cityId,
      },
    },
    owner.token
  );
  const image = await coverImage(spec.colour);
  const upload = await api.call(
    "begin_media_upload",
    { p_kind: "image", p_bytes: image.bytes.length },
    owner.token
  );
  // The website serves this key from NEXT_PUBLIC_MEDIA_URL (/e2e-media/<key>).
  assert.match(upload.object_key, /^media\/[a-f0-9-]{36}$/);
  const mediaFile = path.join(root, "public", "e2e-media", ...upload.object_key.split("/"));
  mkdirSync(path.dirname(mediaFile), { recursive: true });
  writeFileSync(mediaFile, image.bytes);
  await api.call(
    "finalize_media",
    {
      p_object_id: upload.object_id,
      p_size: image.bytes.length,
      p_sha256: image.sha256,
      p_mime: "image/jpeg",
      p_width: 800,
      p_height: 600,
    },
    null,
    true
  );
  post = await api.call(
    "set_post_media",
    {
      p_post_id: post.id,
      p_expected_revision: post.revision,
      p_items: [{ object_id: upload.object_id, purpose: "cover", position: 0 }],
    },
    owner.token
  );
  post = await api.call(
    "submit_post",
    { p_post_id: post.id, p_expected_revision: post.revision },
    owner.token
  );
  const lease = await api.call(
    "claim_queue_item",
    { p_subject: "post", p_id: post.id },
    moderator.token
  );
  await api.call(
    "moderate_post",
    {
      p_post_id: post.id,
      p_expected_revision: post.revision,
      p_decision: "approve",
      p_reason: null,
      p_claim_generation: lease.claim_generation,
      p_claim_nonce: lease.claim_nonce,
    },
    moderator.token
  );
  return {
    key: spec.key,
    id: post.id,
    title: spec.title,
    kind: spec.kind,
    mediaKey: upload.object_key,
  };
}

/**
 * Seeds a fresh copy and returns its account and post ids. Authenticator
 * secrets stay in local Auth (auth.mfa_factors); specs read them from there. Refuses a database that
 * already has accounts: reset the copy instead of seeding twice.
 */
export async function seedTestCopy({ root = process.cwd(), status, sql, log = () => {} }) {
  const { posts } = readFixtureFiles();
  const api = localApi(status);
  if (
    sql(
      "select (select count(*) from auth.users) + (select count(*) from private.owner_admin_invitations);"
    ) !== "0"
  )
    throw new Error(
      "The test copy holds data from an earlier or failed seed; run `node --import tsx scripts/foundation-e2e.mjs reset`"
    );
  const accounts = ["invitedMember", "verifiedMember", "moderator", "admin"];

  log("Trusted step: sign-up invitations for the four test accounts.");
  sql(
    `insert into private.owner_admin_invitations(email) values ${accounts
      .map((key) => `(${quote(people[key].email.toLowerCase())})`)
      .join(",")};`
  );
  const refused = await api.request("/auth/v1/signup", {
    body: { email: people.uninvited.email, password: "Local-fixture-refused-0" },
  });
  assert.notEqual(refused.status, 200, "The sign-up gate must refuse uninvited addresses");
  for (const key of accounts) {
    log(`Registering ${key} through the invitation gate and the mail catcher.`);
    await registerThroughInvitation(api, status, people[key]);
  }
  log("Trusted step: closing the invitations of everyone except the admin.");
  sql(
    `update private.owner_admin_invitations set revoked_at=now() where email in (${accounts
      .filter((key) => key !== "admin")
      .map((key) => quote(people[key].email.toLowerCase()))
      .join(",")});`
  );

  const session = {};
  const factors = {};
  for (const key of accounts) session[key] = await signIn(api, people[key]);
  const claimLegalName = async (key) => {
    const profile = await api.call("get_my_profile", {}, session[key].token);
    await api.call(
      "save_my_legal_name",
      {
        p_expected_revision: profile.revision,
        p_first_name: people[key].firstName,
        p_last_name: people[key].lastName,
      },
      session[key].token
    );
  };

  log("Admin: verifying an authenticator app claims the owner-setup invitation.");
  factors.admin = await enrolTotp(api, session.admin.token, "admin");
  session.admin = { ...session.admin, ...(await signIn(api, people.admin, factors.admin)) };
  assert.equal(
    sql(
      `select string_agg(role,',') from private.staff_roles where user_id=${quote(session.admin.id)};`
    ),
    "admin"
  );

  log("Trusted step: the admin grants the moderator role; the moderator adds an authenticator.");
  sql(
    `insert into private.staff_roles(user_id,role,granted_by) values(${quote(session.moderator.id)},'moderator',${quote(session.admin.id)});`
  );
  factors.moderator = await enrolTotp(api, session.moderator.token, "moderator");
  session.moderator = {
    ...session.moderator,
    ...(await signIn(api, people.moderator, factors.moderator)),
  };

  log("Verified member: legal name, identity review by the admin, phone and area.");
  for (const key of ["invitedMember", "verifiedMember"]) await claimLegalName(key);
  await verifyIdentity({ api, sql, owner: session.verifiedMember, reviewer: session.admin });
  await verifyPhone({ api, owner: session.verifiedMember });
  await api.call(
    "confirm_verification_locality",
    { p_province: "gp", p_city: "gp_johannesburg" },
    session.verifiedMember.token
  );
  const terms = await api.call("get_current_posting_terms", {}, null);
  await api.call(
    "accept_posting_terms",
    { p_version: terms.version, p_document_hash: terms.document_hash },
    session.verifiedMember.token
  );
  await api.call(
    "grant_verified_intro_trial",
    { p_owner: session.verifiedMember.id, p_days: 7 },
    null,
    true
  );

  log(`Publishing ${posts.length} showroom posts (moderator approval).`);
  const published = [];
  for (const spec of posts)
    published.push(
      await publishPost({
        api,
        root,
        owner: session.verifiedMember,
        moderator: session.moderator,
        spec,
      })
    );

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    accounts: Object.fromEntries(accounts.map((key) => [key, { id: session[key].id }])),
    posts: published,
  };
}
