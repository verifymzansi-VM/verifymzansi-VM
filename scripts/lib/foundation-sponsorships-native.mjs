import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { testSponsorshipBusy } from "./foundation-sponsorship-races-native.mjs";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import { createFoundationPublicApi } from "../../src/lib/foundation/public-api.ts";
import {
  acceptFoundationOrganisationInvite,
  applyToFoundationOrganisation,
  decideFoundationApplication,
} from "../../src/lib/foundation/organisations.ts";
import {
  changeFoundationSponsorship,
  readFoundationOrganisationSponsorships,
  readFoundationPostSponsorships,
  readFoundationProgrammeShowcases,
  readMyFoundationSponsorships,
  saveFoundationProgrammeShowcase,
} from "../../src/lib/foundation/organisation-sponsorships.ts";
import {
  attachFixtureCover,
  createPostingVerifier,
  createTrustedPostingFixture,
  publishFixturePost,
} from "./foundation-trusted-posting-fixture.mjs";

// Synthetic local proof of sponsored places, the waiting list, the
// entitlement each place owns, and programme showcases.
export async function testSponsorships({
  createUser,
  rpc,
  sql,
  sqlFails,
  record,
  connection,
  fixtureAdminId,
  stage,
  controlledSql,
}) {
  stage("sponsorships staff, reviewer and verified people");
  const reviewer = await createPostingVerifier({ createUser, sql, fixtureAdminId });
  const fixture = createTrustedPostingFixture({ rpc, sql, reviewer });
  const commercial = await createPostingVerifier({
    createUser,
    sql,
    fixtureAdminId,
    role: "admin",
    label: "spon-commercial",
  });
  const orgAdmin = await createUser("spon-admin");
  const ownerA = await createUser("spon-owner-a");
  const ownerB = await createUser("spon-owner-b");
  const ownerC = await createUser("spon-owner-c");
  const other = await createUser("spon-other");
  for (const user of [orgAdmin, ownerA, ownerB, ownerC]) await fixture.ready(user);
  const typed = (user) => createFoundationAuthenticatedApi(connection, user.token);
  const publicApi = createFoundationPublicApi(connection);
  const call = async (name, body, user, service = false) => {
    const response = await rpc(name, body, user?.token ?? null, service);
    assert.equal(response.status, 200, "sponsorship fixture " + name);
    return response.data;
  };
  const staff = async (name, body) => {
    await commercial.refresh();
    return rpc(name, body, commercial.token);
  };
  const refusedWith = (reason) => (error) =>
    // Compared by name: tsx may load the shared module twice, defeating instanceof.
    error?.name === "Error" &&
    String(error.message).startsWith("Foundation organisation request failed") &&
    error.reason === reason;
  const one = (query) => sql(query);
  const notifications = (user, kind) =>
    one(
      "select count(*) from private.notifications where account_id='" +
        user.id +
        "' and kind='" +
        kind +
        "';"
    );

  stage("sponsorships programme and administrator");
  const reason = "Synthetic local sponsorship setup";
  const slug = "synthetic-sponsor-" + randomBytes(3).toString("hex");
  const created = await staff("create_organisation", {
    p_slug: slug,
    p_name: "Synthetic Supplier Network",
    p_type: "enterprise_development",
    p_reason: reason,
  });
  assert.equal(created.status, 200);
  const org = created.data.id;
  const patchOrg = async (patch) => {
    const revision = Number(
      one("select revision from private.organisations where id='" + org + "';")
    );
    const result = await staff("update_organisation", {
      p_id: org,
      p_expected_revision: revision,
      p_patch: patch,
      p_reason: reason,
    });
    assert.equal(result.status, 200, "organisation update");
  };
  await patchOrg({
    is_public: true,
    programme_status: "founding_trial",
    sponsored_capacity: 1,
    province_id: "gp",
  });
  const programme = (
    await staff("save_organisation_programme", {
      p_org: org,
      p_slug: "supplier-pilot",
      p_name: "Supplier pilot",
      p_reason: reason,
    })
  ).data;
  const plain = randomBytes(32).toString("base64url");
  assert.equal(
    (
      await staff("invite_organisation_admin", {
        p_org: org,
        p_email: one("select email from auth.users where id='" + orgAdmin.id + "';"),
        p_token_hash: createHash("sha256").update(plain).digest("hex"),
        p_reason: reason,
      })
    ).status,
    200
  );
  await acceptFoundationOrganisationInvite(typed(orgAdmin), { token: plain });

  const business = async (owner, title) => {
    let post = await call(
      "create_core_draft",
      {
        p_kind: "business",
        p_area: "business",
        p_category_key: "automotive_services",
        p_detail: {},
      },
      owner
    );
    post = await call(
      "save_post_content",
      {
        p_post_id: post.id,
        p_expected_revision: post.revision,
        p_content: {
          title,
          description: "Synthetic local business for sponsorship verification.",
          province_id: "gp",
          city_id: "gp_johannesburg",
        },
      },
      owner
    );
    return attachFixtureCover((n, b, u, s) => call(n, b, u, s), post, owner);
  };
  const affiliate = async (owner, post) => {
    const application = await applyToFoundationOrganisation(typed(owner), {
      organisation_id: org,
      post_id: post.id,
      programme_id: programme.id,
      share_representative_name: false,
      consent: true,
      reason: "We supply the programme partners.",
    });
    return (
      await decideFoundationApplication(typed(orgAdmin), {
        application_id: application.id,
        decision: "approve",
      })
    ).affiliation_id;
  };
  const publish = (owner, post) =>
    publishFixturePost({ call: (n, b, u) => call(n, b, u ?? owner), sql, post, reviewer });
  const sponsorReason = "Supported place for the pilot (synthetic).";
  const sponsor = (affiliation, user = orgAdmin) =>
    changeFoundationSponsorship(typed(user), {
      action: "sponsor",
      affiliation_id: affiliation,
      reason: sponsorReason,
    });
  const status = (id) =>
    one("select status from private.organisation_sponsorships where id='" + id + "';");
  const entitlementOf = (id) =>
    one(
      "select e.source||':'||e.area||':'||e.slot_capacity||':'||e.status from private.entitlements e join private.organisation_sponsorships s on s.entitlement_id=e.id where s.id='" +
        id +
        "';"
    );

  stage("sponsorships authority and capacity");
  let postA = await business(ownerA, "Synthetic Panel Beaters");
  const postB = await business(ownerB, "Synthetic Tyre Centre");
  const affiliationA = await affiliate(ownerA, postA);
  const affiliationB = await affiliate(ownerB, postB);
  for (const user of [other, ownerA, ownerB])
    await assert.rejects(sponsor(affiliationA, user), refusedWith("forbidden"));
  await reviewer.refresh();
  await assert.rejects(sponsor(affiliationA, reviewer), refusedWith("forbidden"));
  const shortReason = await rpc(
    "sponsor_business",
    { p_affiliation: affiliationA, p_reason: "no" },
    orgAdmin.token
  );
  assert.equal(shortReason.status, 400);
  assert.equal(shortReason.data.details, "reason_required");
  const placeA = await sponsor(affiliationA);
  assert.equal(placeA.status, "active");
  assert.equal(placeA.sponsor_type, "founding");
  assert.equal(entitlementOf(placeA.id), "sponsorship:business:1:active");
  await assert.rejects(sponsor(affiliationA), refusedWith("conflict"));
  const placeB = await sponsor(affiliationB);
  assert.equal(placeB.status, "waitlisted");
  assert.equal(placeB.ends_at, null);
  assert.equal(entitlementOf(placeB.id), "");
  assert.equal(notifications(ownerA, "organisation_sponsorship_activated"), "1");
  record("native-sponsorship-admin-only-capacity-under-lock-waitlist-and-one-entitlement");

  stage("sponsorships trial register and funding");
  // A sponsored member is bound to the trial register and gets no later trial.
  assert.equal(
    one(
      "select count(*) from private.trial_identities t join private.organisation_sponsorships s on s.entitlement_id=t.entitlement_id where s.id='" +
        placeA.id +
        "' and t.owner_id='" +
        ownerA.id +
        "';"
    ),
    "1"
  );
  const laterTrial = await call(
    "grant_verified_intro_trial",
    { p_owner: ownerA.id, p_days: 7 },
    null,
    true
  );
  assert.deepEqual(laterTrial, { granted: false, reason: "identity_already_used" });
  postA = await publish(ownerA, postA);
  assert.equal(
    one(
      "select e.source from private.post_activations a join private.entitlements e on e.id=a.entitlement_id where a.post_id='" +
        postA.id +
        "' and a.released_at is null;"
    ),
    "sponsorship"
  );
  const badges = await readFoundationPostSponsorships(publicApi, { post_ids: [postA.id] });
  assert.deepEqual(badges, [
    {
      post_id: postA.id,
      organisation_slug: slug,
      organisation_name: "Synthetic Supplier Network",
      label: "Supported by",
    },
  ]);
  record("native-sponsorship-funds-a-live-post-badge-and-blocks-a-later-intro-trial");
  stage("sponsorship busy retirement and active period invariants");
  await testSponsorshipBusy({
    sql,
    sqlFails,
    controlledSql,
    rpc,
    postId: postA.id,
    sponsorshipId: placeA.id,
    token: orgAdmin.token,
    record,
  });

  stage("sponsorships administrator and owner views");
  const view = await readFoundationOrganisationSponsorships(typed(orgAdmin), {
    organisation_id: org,
  });
  assert.deepEqual([view.capacity, view.active, view.waitlisted], [1, 1, 1]);
  for (const hidden of [ownerA.id, ownerB.id, "identity_hmac", "phone"])
    assert.equal(JSON.stringify(view).includes(hidden), false);
  await assert.rejects(
    readFoundationOrganisationSponsorships(typed(ownerA), { organisation_id: org }),
    refusedWith("forbidden")
  );
  assert.deepEqual(
    (await readMyFoundationSponsorships(typed(ownerA))).map((x) => x.status),
    ["active"]
  );
  assert.deepEqual(
    (await readMyFoundationSponsorships(typed(ownerB))).map((x) => x.status),
    ["waitlisted"]
  );
  assert.deepEqual(await readMyFoundationSponsorships(typed(other)), []);
  record("native-sponsorship-minimal-admin-list-and-owner-only-own-places");

  stage("sponsorships capacity change, end and affiliation revoke");
  await patchOrg({ sponsored_capacity: 2 });
  assert.equal(status(placeB.id), "active");
  assert.equal(notifications(ownerB, "organisation_sponsorship_activated"), "1");
  const ended = await changeFoundationSponsorship(typed(orgAdmin), {
    action: "end",
    sponsorship_id: placeA.id,
    reason: "Pilot place reassigned (synthetic).",
  });
  assert.equal(ended.status, "ended");
  assert.equal(entitlementOf(placeA.id), "sponsorship:business:1:revoked");
  assert.equal(
    one(
      "select p.status||':'||d.is_visible from private.posts p join private.post_search_documents d on d.post_id=p.id where p.id='" +
        postA.id +
        "';"
    ),
    "expired:false"
  );
  assert.equal(await call("get_public_post", { p_id: postA.id }, null), null);
  assert.deepEqual(await readFoundationPostSponsorships(publicApi, { post_ids: [postA.id] }), []);
  assert.equal(notifications(ownerA, "organisation_sponsorship_ended"), "1");
  await assert.rejects(
    changeFoundationSponsorship(typed(orgAdmin), {
      action: "end",
      sponsorship_id: placeA.id,
      reason: "Pilot place reassigned (synthetic).",
    }),
    refusedWith("conflict")
  );
  await call(
    "org_update_affiliation",
    { p_affiliation: affiliationB, p_action: "revoke", p_value: "Supplier left the programme." },
    orgAdmin
  );
  assert.equal(
    one(
      "select status||':'||end_reason from private.organisation_sponsorships where id='" +
        placeB.id +
        "';"
    ),
    "revoked:Affiliation ended"
  );
  assert.equal(entitlementOf(placeB.id), "sponsorship:business:1:revoked");
  record("native-sponsorship-end-and-affiliation-revoke-revoke-entitlement-and-unpublish");

  stage("sponsorships programme status, sweep and deletion");
  const founding = await sponsor(affiliationA);
  assert.equal(founding.sponsor_type, "founding");
  await patchOrg({ programme_status: "active_paid" });
  assert.equal(
    one(
      "select status||':'||end_reason from private.organisation_sponsorships where id='" +
        founding.id +
        "';"
    ),
    "ended:Programme status changed"
  );
  const paid = await sponsor(affiliationA);
  assert.deepEqual([paid.status, paid.sponsor_type], ["active", "organisation"]);
  sql(
    "update private.organisation_sponsorships set starts_at=statement_timestamp()-interval '2 hours',ends_at=statement_timestamp()-interval '1 hour' where id='" +
      paid.id +
      "';"
  );
  const sweep = await call("sweep_sponsorships", { p_limit: 50 }, null, true);
  assert.ok(sweep.ended >= 1);
  assert.equal(
    one(
      "select status||':'||end_reason from private.organisation_sponsorships where id='" +
        paid.id +
        "';"
    ),
    "ended:Sponsorship period ended"
  );
  assert.equal(entitlementOf(paid.id), "sponsorship:business:1:revoked");
  const cascaded = await sponsor(affiliationA);
  const cascadedEntitlement = one(
    "select entitlement_id from private.organisation_sponsorships where id='" + cascaded.id + "';"
  );
  sql("delete from private.organisation_sponsorships where id='" + cascaded.id + "';");
  assert.equal(
    one("select status from private.entitlements where id='" + cascadedEntitlement + "';"),
    "revoked"
  );
  sqlFails(
    "update private.organisation_sponsorships set sponsor_type='organisation' where id='" +
      placeA.id +
      "';",
    "23514"
  );
  sqlFails(
    "update private.organisation_sponsorships set status='active' where id='" + placeA.id + "';",
    "23514"
  );
  await patchOrg({ programme_status: "suspended" });
  const inactive = await rpc(
    "sponsor_business",
    { p_affiliation: affiliationA, p_reason: sponsorReason },
    orgAdmin.token
  );
  assert.equal(inactive.status, 409);
  assert.equal(inactive.data.details, "programme_inactive");
  await patchOrg({ programme_status: "founding_trial" });
  record("native-sponsorship-type-follows-programme-sweep-ends-due-places-and-history-immutable");

  stage("showcases staff configuration");
  // Synthetic capability setup so one owner can publish three businesses.
  sql(
    "insert into private.entitlements(owner_id,source,area,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at) values('" +
      ownerC.id +
      "','staff_grant','business','" +
      reviewer.id +
      "',3,10,1,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '7 days');"
  );
  const cards = [];
  for (const title of ["Synthetic Bakery", "Synthetic Florist", "Synthetic Printer"]) {
    const post = await business(ownerC, title);
    await affiliate(ownerC, post);
    cards.push(await publish(ownerC, post));
  }
  const window = {
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  };
  const showcaseInput = {
    organisation_id: org,
    showcase_id: null,
    expected_revision: null,
    title: "Supplier pilot spotlight",
    placement: "business",
    enabled: true,
    ...window,
    max_cards: 3,
    display_order: 1,
    sponsored_only: false,
    programme_id: programme.id,
    reason,
  };
  await reviewer.refresh();
  await assert.rejects(
    saveFoundationProgrammeShowcase(typed(reviewer), showcaseInput),
    refusedWith("forbidden")
  );
  await assert.rejects(
    saveFoundationProgrammeShowcase(typed(orgAdmin), showcaseInput),
    refusedWith("forbidden")
  );
  const badPlacement = await staff("save_programme_showcase", {
    p_org: org,
    p_title: "Supplier pilot spotlight",
    p_placement: "everywhere",
    p_enabled: true,
    p_starts_at: window.starts_at,
    p_ends_at: window.ends_at,
    p_max_cards: 3,
    p_display_order: 1,
    p_sponsored_only: false,
    p_reason: reason,
  });
  assert.equal(badPlacement.status, 400);
  assert.equal(badPlacement.data.details, "showcase_invalid");
  const saved = await saveFoundationProgrammeShowcase(
    typed(await commercial.refresh()),
    showcaseInput
  );
  assert.equal(saved.revision, 1);
  record("native-showcase-staff-only-validated-configuration");

  stage("showcases public read");
  let shown = (await readFoundationProgrammeShowcases(publicApi, { placement: "business" })).find(
    (x) => x.id === saved.id
  );
  assert.equal(shown.cards.length, 3);
  assert.deepEqual(new Set(shown.cards.map((c) => c.post_id)), new Set(cards.map((c) => c.id)));
  assert.equal(JSON.stringify(shown).includes(ownerC.id), false);
  assert.deepEqual(await readFoundationProgrammeShowcases(publicApi, { placement: "home" }), []);
  await assert.rejects(
    saveFoundationProgrammeShowcase(typed(await commercial.refresh()), {
      ...showcaseInput,
      showcase_id: saved.id,
      expected_revision: 5,
    }),
    refusedWith("conflict")
  );
  const sponsoredOnly = await saveFoundationProgrammeShowcase(typed(await commercial.refresh()), {
    ...showcaseInput,
    showcase_id: saved.id,
    expected_revision: 1,
    sponsored_only: true,
  });
  assert.equal(sponsoredOnly.revision, 2);
  // No card is sponsored, so the spotlight falls below three cards and hides.
  shown = (await readFoundationProgrammeShowcases(publicApi, { placement: "business" })).find(
    (x) => x.id === saved.id
  );
  assert.equal(shown, undefined);
  record("native-showcase-public-only-live-covered-programme-cards-and-minimum-three");
}
