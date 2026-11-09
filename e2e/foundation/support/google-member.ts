// A "Google member" for the foundation test copy (M0.9e): an account that
// signed up with Google and has no password. The copy cannot reach Google, so
// the account is made the way local Auth (GoTrue) itself stores a Google
// sign-up, in three trusted local steps on the copy only:
//   1. an invitation, because production's sign-up hook admits only invited
//      addresses, for Google sign-ups too (closed again at the end);
//   2. local Auth's admin API creates the user with a confirmed email (Google
//      confirms the address), through that same sign-up hook, so the
//      database's own sign-up trigger creates the member's profile;
//   3. local SQL turns the account into what GoTrue writes after a Google
//      sign-up: one identity with provider "google", the Google subject as
//      provider id and Google's claims as identity data; app metadata
//      provider "google" / providers ["google"]; no password (empty hash).
// Local Auth's own admin view of the user is then checked: exactly one
// identity, provider google, and password sign-in is refused. The member signs
// in through a one-time local Auth link (linkSession), which changes nothing
// about the account; that session is recorded as a Google (`oauth`) sign-in,
// since the website does not count a link redeemed at Auth as a sign-in.
import { randomInt, randomUUID } from "node:crypto";
import { authAdmin, queryTestCopy, readTestCopy, signIn, linkSession } from "./test-copy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type GoogleMember = { id: string; email: string; fullName: string };

/** Quotes a JSON value as an SQL literal (no user input reaches it). */
function jsonLiteral(value: unknown) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

export async function registerGoogleMember(label: string): Promise<GoogleMember> {
  if (!/^[a-z]{3,20}$/.test(label)) throw new Error("Unexpected label");
  const ref = randomUUID().slice(0, 8);
  const email = `${label}-${ref}@verifymzansi.test`;
  const suffix = [...ref].map((c) => "abcdefghijklmnop"[parseInt(c, 16)]).join("");
  const fullName = `Zanele ${label[0].toUpperCase()}${label.slice(1)}-${suffix}`;
  // A Google subject is a decimal number of about 21 digits.
  const subject = `1${String(randomInt(1e9, 1e10 - 1))}${String(randomInt(1e9, 1e10 - 1))}`;
  const claims = {
    iss: "https://accounts.google.com",
    sub: subject,
    name: fullName,
    email,
    picture: "",
    full_name: fullName,
    avatar_url: "",
    provider_id: subject,
    email_verified: true,
    phone_verified: false,
  };
  queryTestCopy(`insert into private.owner_admin_invitations(email) values ('${email}');`);
  try {
    const created = await authAdmin("/auth/v1/admin/users", {
      email,
      email_confirm: true,
      user_metadata: claims,
    });
    const id = String(created.data?.id ?? "");
    if (created.status !== 200 || !UUID.test(id))
      throw new Error(`Local Auth refused the Google member (${created.status})`);
    const moved = queryTestCopy(
      `update auth.identities set provider = 'google', provider_id = '${subject}', ` +
        `identity_data = ${jsonLiteral(claims)} ` +
        `where user_id = '${id}' and provider = 'email' returning id;`
    );
    if (!UUID.test(moved)) throw new Error("The new account had no single email identity");
    queryTestCopy(
      "update auth.users set encrypted_password = '', " +
        `raw_app_meta_data = ${jsonLiteral({ provider: "google", providers: ["google"] })}, ` +
        `raw_user_meta_data = ${jsonLiteral(claims)} where id = '${id}';`
    );
    // Local Auth's own view of the account: one Google identity, no password.
    const stored = await authAdmin(`/auth/v1/admin/users/${id}`);
    const providers = (stored.data?.identities ?? []).map(
      (identity: { provider: string }) => identity.provider
    );
    if (
      stored.status !== 200 ||
      providers.join() !== "google" ||
      stored.data?.app_metadata?.providers?.join() !== "google"
    )
      throw new Error("Local Auth does not hold the account as a Google member");
    const passwordRefused = await signIn(readTestCopy(), {
      email,
      password: `Local-fixture-${label}-${ref}`,
    }).then(
      () => false,
      () => true
    );
    if (!passwordRefused) throw new Error("A Google member must have no password");
    return { id, email, fullName };
  } finally {
    // Closed once used, so it can never be claimed as an owner-admin invitation.
    queryTestCopy(
      `update private.owner_admin_invitations set revoked_at = now() where email = '${email}';`
    );
  }
}

/** A real local Auth session for the Google member (see linkSession), signed
 * in now or `signInAgeSeconds` ago. */
export function googleMemberSession(member: GoogleMember, signInAgeSeconds?: number) {
  return linkSession(readTestCopy(), member.email, signInAgeSeconds);
}
