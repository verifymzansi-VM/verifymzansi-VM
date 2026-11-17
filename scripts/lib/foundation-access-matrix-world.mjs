// Shared by the two API access matrices: the native one on the prototype
// fixture (foundation-access-matrix-native.mjs) and the one on the replayed
// production schema (scripts/test-foundation-access-matrix.mjs). Builds owner
// A's private world through the production commands and generates the sweep's
// synthetic arguments.
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { buildFoundationEnquiry } from "../../src/lib/foundation/owner-inbox.ts";
import { attachFixtureCover, publishFixturePost } from "./foundation-trusted-posting-fixture.mjs";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };

/** Eight random lower-case letters, so each run's private values are unique. */
export const syntheticLetters = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join("");

/**
 * Owner A's world, built through the production commands as A, the
 * independent `reviewer`, the staff `admin`, the organisation administrator
 * and the service role (`call(name, body, principal, service)`): a live event
 * (from `startsAt` to `endsAt`) with a buyer's enquiry, a business draft with a
 * cover, a public organisation with a programme whose administrator accepted
 * an invitation, and A's consented application to it.
 */
export async function buildAccessOwnerWorld({
  call,
  sql,
  owner,
  reviewer,
  admin,
  orgAdmin,
  orgAdminEmail,
  startsAt,
  endsAt,
}) {
  let live = await call("create_core_draft", {
    p_kind: "event",
    p_area: "tourism_events",
    p_category_key: "events",
    p_activity_key: reference.activities.find((a) => a.category === "events").key,
    p_detail: {
      contact_channels: ["form", "call"],
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone: "Africa/Johannesburg",
    },
  });
  live = await call("save_post_content", {
    p_post_id: live.id,
    p_expected_revision: live.revision,
    p_content: {
      title: "Synthetic access matrix event",
      description: "Synthetic local access matrix verification event.",
      province_id: "gp",
      city_id: "gp_johannesburg",
    },
  });
  live = await attachFixtureCover(call, live, owner);
  live = await publishFixturePost({ call, sql, post: live, reviewer });
  const buyer = {
    email: "buyer-" + syntheticLetters() + "@example.invalid",
    phone: "+2782" + String(randomInt(10000000)).padStart(7, "0"),
    name: "Buyer " + syntheticLetters(),
    message: "Synthetic private question " + syntheticLetters(),
  };
  await call(
    "submit_enquiry",
    buildFoundationEnquiry(
      {
        request_id: randomUUID(),
        post_id: live.id,
        buyer_name: buyer.name,
        buyer_email: buyer.email,
        buyer_phone: buyer.phone,
        message: buyer.message,
      },
      null
    ),
    null,
    true
  );
  let business = await call("create_core_draft", {
    p_kind: "business",
    p_area: "business",
    p_category_key: "automotive_services",
    p_detail: {},
  });
  business = await call("save_post_content", {
    p_post_id: business.id,
    p_expected_revision: business.revision,
    p_content: {
      title: "Synthetic access workshop",
      description: "Synthetic local business for access matrix verification.",
      province_id: "gp",
      city_id: "gp_johannesburg",
    },
  });
  business = await attachFixtureCover(call, business, owner);
  if (typeof admin.refresh === "function") await admin.refresh();
  const reason = "Synthetic access matrix organisation";
  const orgSlug = "access-org-" + syntheticLetters();
  const org = await call(
    "create_organisation",
    { p_slug: orgSlug, p_name: "Synthetic Access Org", p_type: "other", p_reason: reason },
    admin
  );
  await call(
    "update_organisation",
    {
      p_id: org.id,
      p_expected_revision: org.revision,
      p_patch: { is_public: true, programme_status: "founding_trial", admin_limit: 2 },
      p_reason: reason,
    },
    admin
  );
  const programme = await call(
    "save_organisation_programme",
    { p_org: org.id, p_slug: "access-pilot", p_name: "Access pilot", p_reason: reason },
    admin
  );
  const inviteToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(inviteToken).digest("hex");
  await call(
    "invite_organisation_admin",
    { p_org: org.id, p_email: orgAdminEmail, p_token_hash: tokenHash, p_reason: reason },
    admin
  );
  await call("accept_organisation_invite", { p_token_hash: tokenHash }, orgAdmin);
  const application = await call("apply_to_organisation", {
    p_org: org.id,
    p_post_id: business.id,
    p_programme: programme.id,
    p_share_representative_name: false,
    p_consent: true,
    p_reason: "We are members of this synthetic organisation.",
  });
  return { live, buyer, business, org, orgSlug, programme, tokenHash, application };
}

/**
 * An integer argument for the sweep: the current case version or revision of
 * the target (so a missing ownership check would let the call through), and
 * otherwise `fixed[name]`, a page of 50, 128 bytes or 1.
 */
export function sweepInteger(name, body, { caseVersion, revisionOf, revisionTarget, fixed = {} }) {
  if (name === "p_expected_version") return caseVersion();
  if (name === "p_expected_revision_a") return revisionOf(body.p_post_a);
  if (name === "p_expected_revision_b") return revisionOf(body.p_post_b);
  if (/revision/.test(name)) return revisionOf(revisionTarget(body));
  return { p_limit: 50, p_bytes: 128, p_size: 128, ...fixed }[name] ?? 1;
}

/**
 * Up to eight argument sets for command `fn` ({ name, args: [{ name, type }] }):
 * every combination of the candidate values per argument. `typed(arg, fn)` may
 * return the values for an argument first; integers are filled last by
 * `integer(name, body)`, which may read the chosen targets.
 */
export function sweepBodies(fn, { uuids, uuidArray, text, integer, typed = () => undefined }) {
  let combos = [{}];
  for (const arg of fn.args) {
    let values = typed(arg, fn);
    if (values === undefined) {
      if (arg.type === "uuid") values = uuids(arg.name);
      else if (arg.type === "uuid[]") values = [uuidArray(arg.name)];
      else if (arg.type === "integer") values = [null];
      else if (arg.type === "boolean") values = [true];
      else if (arg.type === "jsonb") values = [{}];
      else if (arg.type.startsWith("timestamp")) values = [null];
      else if (arg.name === "p_status" && fn.name.includes("list_")) values = [null];
      else values = [text(arg.name)];
    }
    combos = combos.flatMap((body) => values.map((value) => ({ ...body, [arg.name]: value })));
  }
  return combos.slice(0, 8).map((body) => {
    for (const arg of fn.args) if (arg.type === "integer") body[arg.name] = integer(arg.name, body);
    return body;
  });
}
