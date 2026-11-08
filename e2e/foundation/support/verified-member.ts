// A new verified member for one spec run (M0.9c): invited sign-up through local
// Auth, the email confirmed from the mail catcher, the legal name, an identity
// review accepted by the fixture admin, a verified phone, an area and the
// posting terms. Everything goes through the production commands the website
// calls, as the seed does for the fixture's verified member
// (scripts/lib/foundation-e2e-seed.mjs); only the invitation and its closing
// are trusted local SQL steps (an owner SQL session in production). No
// introductory trial is granted: a new member owns nothing until they pay.
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { processIdentityNumber } from "@/lib/domains/verification/identity-processing";
import { E2E_FIXTURE } from "../../../scripts/lib/foundation-e2e-target.mjs";
import {
  latestMailTo,
  queryTestCopy,
  readTestCopy,
  rpc,
  serviceRpc,
  signIn,
  type TestCopy,
} from "./test-copy";

const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type VerifiedMember = {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
};

async function call(copy: TestCopy, name: string, body: unknown, token?: string) {
  const result = await rpc(copy, name, body, token);
  if (result.status !== 200) throw new Error(`Command ${name} answered ${result.status}`);
  return result.data;
}

async function serviceCall(name: string, body: unknown) {
  const result = await serviceRpc(name, body);
  if (result.status !== 200) throw new Error(`Service command ${name} answered ${result.status}`);
  return result.data;
}

/** A valid synthetic South African ID number for an adult (Luhn checksum). */
export function syntheticIdNumber() {
  const digits =
    `${randomInt(70, 100)}` +
    `${randomInt(1, 13)}`.padStart(2, "0") +
    `${randomInt(1, 29)}`.padStart(2, "0") +
    `${randomInt(0, 10_000)}`.padStart(4, "0") +
    "08";
  for (let check = 0; check < 10; check++) {
    const candidate = digits + check;
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      let value = Number(candidate[12 - i]);
      if (i % 2 === 1) {
        value *= 2;
        if (value > 9) value -= 9;
      }
      sum += value;
    }
    if (sum % 10 === 0) return candidate;
  }
  throw new Error("No checksum digit");
}

/** Invited sign-up through local Auth, confirmed from the mail catcher. The
 * display name goes in the sign-up metadata, as the website's registration
 * sends it (the database keeps it only if valid; never authority). */
async function register(copy: TestCopy, email: string, password: string, displayName: string) {
  queryTestCopy(`insert into private.owner_admin_invitations(email) values ('${email}');`);
  const sentAfter = Date.now() - 1000;
  const signup = await fetch(new URL("/auth/v1/signup", API_ORIGIN), {
    method: "POST",
    redirect: "error",
    headers: { apikey: copy.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, data: { display_name: displayName } }),
  });
  if (signup.status !== 200) throw new Error(`Sign-up refused (${signup.status})`);
  const mail = await latestMailTo(email, { after: sentAfter });
  const link = mail.text.match(/http:\/\/127\.0\.0\.1:\d+\/auth\/v1\/verify\?[^\s)\]>"]+/)?.[0];
  if (!link) throw new Error("The confirmation email has no local confirmation link");
  const confirm = new URL(link.replaceAll("&amp;", "&"));
  if (confirm.origin !== API_ORIGIN) throw new Error("Confirmation stays on the local gateway");
  const confirmed = await fetch(confirm, { redirect: "manual" });
  if (
    ![302, 303].includes(confirmed.status) ||
    /error/.test(confirmed.headers.get("location") ?? "")
  )
    throw new Error("Email confirmation failed");
  // Closed once used, so it can never be claimed as an owner-admin invitation.
  queryTestCopy(
    `update private.owner_admin_invitations set revoked_at = now() where email = '${email}';`
  );
}

/** Identity evidence and an accepted review by the fixture admin. */
async function verifyIdentity(copy: TestCopy, ownerId: string, token: string) {
  const opened = await call(copy, "open_verification_case", {}, token);
  const caseId = String(opened.case_id);
  if (!UUID.test(caseId)) throw new Error("Unexpected verification case");
  const artifacts: string[] = [];
  for (const purpose of ["id_front", "selfie"]) {
    const begun = await call(
      copy,
      "begin_evidence_upload",
      { p_case_id: caseId, p_purpose: purpose },
      token
    );
    artifacts.push(begun.artifact_id);
    // Synthetic object metadata, as the uploader and scanner report it; no bytes.
    for (const state of ["uploaded", "clean"])
      await serviceCall("advance_evidence_artifact", {
        p_artifact_id: begun.artifact_id,
        p_state: state,
        p_sha256: createHash("sha256")
          .update(ownerId + purpose)
          .digest("hex"),
        p_size: 128,
      });
  }
  // Throwaway keys: the encrypted number never leaves this local database.
  const processed = processIdentityNumber(ownerId, syntheticIdNumber(), {
    identityMatchKey: randomBytes(32).toString("hex"),
    numberEncryptionKey: randomBytes(32).toString("hex"),
    identityKeyId: "identity-match-v1",
    encryptionKeyId: "identity-number-v1",
  });
  const version = Number(
    queryTestCopy(`select version from private.evidence_cases where id = '${caseId}';`)
  );
  const submitted = await serviceCall("register_identity_submission", {
    p_case: caseId,
    p_expected_version: version,
    p_id_artifact: artifacts[0],
    p_selfie_artifact: artifacts[1],
    p_fingerprint: processed.fingerprint,
    p_identity_key: processed.identityKeyId,
    p_encrypted_number: processed.encryptedNumber,
    p_receipt: randomUUID(),
    p_risk_score: 10,
  });
  const admin = await signIn(copy, "admin");
  const lease = await call(copy, "claim_evidence_case", { p_case_id: caseId }, admin.token);
  const reviewed = await call(
    copy,
    "review_identity_submission",
    {
      p_submission: submitted.submission_id,
      p_expected_version: submitted.case_version,
      p_claim_generation: lease.claim_generation,
      p_claim_nonce: lease.claim_nonce,
      p_number_matches: true,
      p_selfie_matches: true,
    },
    admin.token
  );
  if (reviewed.status !== "accepted") throw new Error("The identity review was not accepted");
}

/** The phone proof the website records after a matching SMS code (the
 * member pages open only for members with a verified phone). */
export async function verifyPhone(ownerId: string) {
  const phone = `+2773${randomInt(1_000_000, 10_000_000)}`;
  const hash = randomBytes(32).toString("hex");
  const challenge = await serviceCall("create_verification_phone_challenge", {
    p_owner: ownerId,
    p_phone: phone,
    p_hash: hash,
  });
  await serviceCall("claim_verification_phone_attempt", {
    p_owner: ownerId,
    p_challenge: challenge.challenge_id,
  });
  const verified = await serviceCall("finalize_verification_phone", {
    p_owner: ownerId,
    p_challenge: challenge.challenge_id,
    p_expected_hash: hash,
  });
  if (verified.verified !== true) throw new Error("Phone verification failed");
}

/**
 * A new member who signed up, confirmed the email, saved the legal name and
 * verified a phone, but has sent no identity evidence yet (M0.9d: the staff
 * review spec sends the ID and selfie photos through the website itself).
 */
export async function registerUnreviewedMember(label: string): Promise<VerifiedMember> {
  const member = await registerConfirmedMember(label);
  const copy = readTestCopy();
  const session = await signIn(copy, member);
  const profile = await call(copy, "get_my_profile", {}, session.token);
  await call(
    copy,
    "save_my_legal_name",
    {
      p_expected_revision: profile.revision,
      p_first_name: member.firstName,
      p_last_name: member.lastName,
    },
    session.token
  );
  await verifyPhone(member.id);
  return member;
}

/**
 * A new member who signed up (invited) and confirmed the email, and nothing
 * else (M0.9e: account recovery and self-service need no verification).
 */
export async function registerConfirmedMember(label: string): Promise<VerifiedMember> {
  if (!/^[a-z]{3,20}$/.test(label)) throw new Error("Unexpected label");
  const copy = readTestCopy();
  const ref = randomUUID().slice(0, 8);
  const email = `${label}-${ref}@verifymzansi.test`;
  const password = `Local-fixture-${label}-${ref}`;
  // Letters only (legal-name rules), unique per run so staff find this
  // member's case among earlier runs' cases.
  const suffix = [...ref].map((c) => "abcdefghijklmnop"[parseInt(c, 16)]).join("");
  const lastName = `${label[0].toUpperCase()}${label.slice(1)}-${suffix}`;
  await register(copy, email, password, `Naledi ${lastName}`);
  const id = queryTestCopy(
    `select id from auth.users where email = '${email}' and email_confirmed_at is not null;`
  );
  if (!UUID.test(id)) throw new Error("The new member was not confirmed");
  return { id, email, password, firstName: "Naledi", lastName };
}

/** The posting terms, as the member accepts them on the create page. */
export async function acceptPostingTerms(member: VerifiedMember) {
  const copy = readTestCopy();
  const session = await signIn(copy, member);
  const terms = await call(copy, "get_current_posting_terms", {});
  await call(
    copy,
    "accept_posting_terms",
    { p_version: terms.version, p_document_hash: terms.document_hash },
    session.token
  );
}

/** A new verified member with no plan, no trial and no posts. */
export async function registerVerifiedMember(label: string): Promise<VerifiedMember> {
  const member = await registerUnreviewedMember(label);
  const session = await signIn(readTestCopy(), member);
  await verifyIdentity(readTestCopy(), member.id, session.token);
  await call(
    readTestCopy(),
    "confirm_verification_locality",
    { p_province: "gp", p_city: "gp_johannesburg" },
    session.token
  );
  await acceptPostingTerms(member);
  return member;
}
