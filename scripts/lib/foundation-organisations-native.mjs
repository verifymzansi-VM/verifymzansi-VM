import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import { createFoundationPublicApi } from "../../src/lib/foundation/public-api.ts";
import {
  FoundationOrganisationError,
  acceptFoundationOrganisationInvite,
  applyToFoundationOrganisation,
  decideFoundationApplication,
  readFoundationOrganisationApplications,
  readFoundationOrganisationLinks,
  readFoundationOrganisationDirectory,
  readFoundationPostAffiliations,
  readFoundationPublicOrganisation,
} from "../../src/lib/foundation/organisations.ts";
import {
  attachFixtureCover,
  createPostingVerifier,
  createTrustedPostingFixture,
} from "./foundation-trusted-posting-fixture.mjs";

// Synthetic local proof of organisations, invitations and affiliation.
export async function testOrganisations({
  createUser,
  rpc,
  sql,
  sqlFails,
  record,
  connection,
  fixtureAdminId,
  stage,
}) {
  stage("organisations staff, reviewer and verified people");
  const reviewer = await createPostingVerifier({ createUser, sql, fixtureAdminId });
  const fixture = createTrustedPostingFixture({ rpc, sql, reviewer });
  const commercial = await createPostingVerifier({
    createUser,
    sql,
    fixtureAdminId,
    role: "admin",
    label: "org-commercial",
  });
  const orgAdmin = await createUser("org-admin");
  const unverified = await createUser("org-unverified");
  const owner = await createUser("org-owner");
  await fixture.ready(orgAdmin);
  await fixture.ready(owner);
  const typed = (user) => createFoundationAuthenticatedApi(connection, user.token);
  const publicApi = createFoundationPublicApi(connection);
  const call = async (name, body, user, service = false) => {
    const response = await rpc(name, body, user?.token ?? null, service);
    assert.equal(response.status, 200, "organisation fixture " + name);
    return response.data;
  };
  const staff = async (name, body) => {
    await commercial.refresh();
    return rpc(name, body, commercial.token);
  };
  const refused = (response, status, detail) => {
    assert.equal(response.status, status);
    if (detail) assert.equal(response.data.details, detail);
  };

  stage("organisations staff creation and update");
  const slug = "synthetic-chamber-" + randomBytes(3).toString("hex");
  const reason = "Synthetic local organisation setup";
  for (const who of [owner, reviewer]) {
    if (who === reviewer) await reviewer.refresh();
    assert.equal(
      (
        await rpc(
          "create_organisation",
          { p_slug: slug, p_name: "X", p_type: "other", p_reason: reason },
          who.token
        )
      ).status,
      403
    );
  }
  refused(
    await staff("create_organisation", {
      p_slug: "Bad Slug",
      p_name: "Synthetic",
      p_type: "other",
      p_reason: reason,
    }),
    400,
    "organisation_invalid"
  );
  refused(
    await staff("create_organisation", {
      p_slug: slug,
      p_name: "Synthetic",
      p_type: "other",
      p_reason: "no",
    }),
    400,
    "reason_required"
  );
  const created = (
    await staff("create_organisation", {
      p_slug: slug,
      p_name: "Synthetic Chamber",
      p_type: "chamber_of_commerce",
      p_reason: reason,
    })
  ).data;
  assert.equal(created.revision, 1);
  refused(
    await staff("create_organisation", {
      p_slug: slug,
      p_name: "Other",
      p_type: "other",
      p_reason: reason,
    }),
    409,
    "organisation_slug_taken"
  );
  const org = created.id;
  const update = (revision, patch) =>
    staff("update_organisation", {
      p_id: org,
      p_expected_revision: revision,
      p_patch: patch,
      p_reason: reason,
    });
  for (const patch of [
    { owner_id: owner.id },
    { website: "http://insecure.example" },
    { admin_limit: 0 },
    { programme_status: "everything" },
    { is_public: "yes" },
  ])
    refused(await update(1, patch), 400, "organisation_invalid");
  refused(await update(5, { name: "Changed" }), 409, "organisation_changed");
  const published = (
    await update(1, {
      is_public: true,
      programme_status: "founding_trial",
      province_id: "gp",
      website: "https://chamber.example.org/about",
      public_email: "info@chamber.example.org",
      admin_limit: 2,
      description: "Synthetic local organisation for verification.",
    })
  ).data;
  assert.equal(published.revision, 2);
  const programme = (
    await staff("save_organisation_programme", {
      p_org: org,
      p_slug: "founding-pilot",
      p_name: "Founding pilot",
      p_reason: reason,
    })
  ).data;
  record("native-organisations-staff-only-creation-allowlisted-revision-fenced-update");

  stage("organisations public directory and logo permission");
  let directory = await readFoundationOrganisationDirectory(publicApi);
  let listed = directory.find((x) => x.slug === slug);
  assert.equal(listed.logo_object_key, null);
  assert.equal(listed.on_strip, false);
  const detail = await readFoundationPublicOrganisation(publicApi, { slug });
  assert.equal(detail.name, "Synthetic Chamber");
  assert.deepEqual(
    detail.programmes.map((p) => p.slug),
    ["founding-pilot"]
  );
  assert.equal(JSON.stringify(detail).includes(commercial.id), false);
  const image = await call("begin_media_upload", { p_kind: "image", p_bytes: 128 }, commercial);
  await call(
    "finalize_media",
    {
      p_object_id: image.object_id,
      p_size: 128,
      p_sha256: createHash("sha256").update(image.object_id).digest("hex"),
      p_mime: "image/png",
      p_width: 400,
      p_height: 400,
    },
    null,
    true
  );
  refused(
    await staff("set_organisation_logo", {
      p_id: org,
      p_expected_revision: 2,
      p_reason: reason,
      p_object_id: image.object_id,
    }),
    400,
    "organisation_invalid"
  );
  await staff("set_organisation_logo", {
    p_id: org,
    p_expected_revision: 2,
    p_reason: reason,
    p_object_id: image.object_id,
    p_permission_reference: "Signed logo consent 2026-10 (synthetic)",
  });
  directory = await readFoundationOrganisationDirectory(publicApi);
  listed = directory.find((x) => x.slug === slug);
  assert.equal(listed.logo_object_key, image.object_key);
  assert.equal(sql("select internal.media_object_in_use('" + image.object_id + "');"), "t");
  record("native-organisations-public-directory-detail-and-logo-only-with-permission");

  stage("organisations administrator invitations");
  const token = () => randomBytes(32).toString("base64url");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const email = (user) => sql("select email from auth.users where id='" + user.id + "';");
  const invite = async (user) => {
    const plain = token();
    const result = await staff("invite_organisation_admin", {
      p_org: org,
      p_email: email(user),
      p_token_hash: hash(plain),
      p_reason: reason,
    });
    assert.equal(result.status, 200);
    return plain;
  };
  const forUnverified = await invite(unverified);
  const forAdmin = await invite(orgAdmin);
  refused(
    await staff("invite_organisation_admin", {
      p_org: org,
      p_email: "third@example.org",
      p_token_hash: hash(token()),
      p_reason: reason,
    }),
    409,
    "admin_limit"
  );
  const preview = await call("preview_organisation_invite", { p_token_hash: hash(forAdmin) }, null);
  assert.equal(preview.status, "open");
  assert.equal(preview.email.includes("***@"), true);
  assert.equal(preview.email === email(orgAdmin), false);
  assert.equal(
    await call("preview_organisation_invite", { p_token_hash: hash(token()) }, null),
    null
  );
  await assert.rejects(
    acceptFoundationOrganisationInvite(typed(owner), { token: forAdmin }),
    (error) => error instanceof FoundationOrganisationError && error.reason === "forbidden"
  );
  await assert.rejects(
    acceptFoundationOrganisationInvite(typed(unverified), { token: forUnverified }),
    (error) =>
      error instanceof FoundationOrganisationError && error.reason === "verification_required"
  );
  const accepted = await acceptFoundationOrganisationInvite(typed(orgAdmin), { token: forAdmin });
  assert.deepEqual(accepted, { organisation_slug: slug, role: "owner" });
  await assert.rejects(
    acceptFoundationOrganisationInvite(typed(orgAdmin), { token: forAdmin }),
    (error) => error instanceof FoundationOrganisationError && error.reason === "invite_invalid"
  );
  assert.equal(
    sql(
      "select count(*) from private.organisation_invites where token_hash='" + hash(forAdmin) + "';"
    ),
    "1"
  );
  assert.equal(
    sql("select count(*) from private.organisation_invites where token_hash ~ '[^a-f0-9]';"),
    "0"
  );
  record(
    "native-organisations-invite-hash-only-masked-preview-email-and-identity-bound-acceptance"
  );

  stage("organisations business application");
  await call("grant_verified_intro_trial", { p_owner: owner.id, p_days: 7 }, null, true);
  let business = await call(
    "create_core_draft",
    { p_kind: "business", p_area: "business", p_category_key: "automotive_services", p_detail: {} },
    owner
  );
  business = await call(
    "save_post_content",
    {
      p_post_id: business.id,
      p_expected_revision: business.revision,
      p_content: {
        title: "Synthetic Auto Workshop",
        description: "Synthetic local business for organisation verification.",
        province_id: "gp",
        city_id: "gp_johannesburg",
      },
    },
    owner
  );
  business = await attachFixtureCover(
    (name, body, user, service) => call(name, body, user, service),
    business,
    owner
  );
  const apply = (input, user = owner) => applyToFoundationOrganisation(typed(user), input);
  const base = {
    organisation_id: org,
    post_id: business.id,
    programme_id: programme.id,
    share_representative_name: false,
    consent: true,
    reason: "We are members of the local chamber.",
  };
  await assert.rejects(apply({ ...base, consent: false }), FoundationOrganisationError);
  await assert.rejects(apply(base, orgAdmin), (error) => error.reason === "not_found");
  const application = await apply(base);
  assert.equal(application.status, "submitted");
  await assert.rejects(apply(base), (error) => error.reason === "conflict");
  assert.equal(
    sql(
      "select count(*) from private.notifications where account_id='" +
        orgAdmin.id +
        "' and kind='organisation_application_received' and organisation_id='" +
        org +
        "';"
    ),
    "1"
  );
  record("native-organisations-consented-own-business-application-and-admin-notification");

  stage("organisations administrator review");
  await assert.rejects(
    readFoundationOrganisationApplications(typed(owner), { organisation_id: org }),
    (error) => ["forbidden", "unavailable"].includes(error.reason)
  );
  const list = await readFoundationOrganisationApplications(typed(orgAdmin), {
    organisation_id: org,
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].identity_verified, true);
  assert.equal(list[0].representative_name, null);
  for (const forbidden of ["identity_hmac", "phone", "applicant_id", owner.id])
    assert.equal(JSON.stringify(list).includes(forbidden), false);
  await decideFoundationApplication(typed(orgAdmin), {
    application_id: application.id,
    decision: "request_info",
    note: "Please add your membership number.",
  });
  // Someone other than the applicant cannot see or answer the request.
  const foreign = await rpc(
    "update_my_application",
    { p_application: application.id, p_action: "respond", p_response: "Member 12345" },
    orgAdmin.token
  );
  assert.equal(foreign.status, 200);
  assert.equal(foreign.data, null);
  await call(
    "update_my_application",
    { p_application: application.id, p_action: "respond", p_response: "Member number 12345" },
    owner
  );
  const approved = await decideFoundationApplication(typed(orgAdmin), {
    application_id: application.id,
    decision: "approve",
  });
  assert.ok(approved.affiliation_id);
  await assert.rejects(
    decideFoundationApplication(typed(orgAdmin), {
      application_id: application.id,
      decision: "decline",
    }),
    (error) => error.reason === "conflict"
  );
  const links = await readFoundationOrganisationLinks(typed(owner));
  assert.equal(links.affiliations[0].label, "Programme Participant");
  assert.equal(
    (await readFoundationOrganisationLinks(typed(orgAdmin))).administers[0].role,
    "owner"
  );
  assert.equal(
    sql(
      "select count(*) from private.notifications where account_id='" +
        owner.id +
        "' and kind='organisation_application_decided';"
    ),
    "2"
  );
  record("native-organisations-admin-only-minimal-review-info-request-and-approval");

  stage("organisations public badges follow live status and revocation");
  assert.deepEqual(
    await readFoundationPostAffiliations(publicApi, { post_ids: [business.id] }),
    []
  );
  business = await call(
    "submit_post",
    { p_post_id: business.id, p_expected_revision: business.revision },
    owner
  );
  await reviewer.refresh();
  const lease = await call("claim_queue_item", { p_subject: "post", p_id: business.id }, reviewer);
  await call(
    "moderate_post",
    {
      p_post_id: business.id,
      p_expected_revision: business.revision,
      p_decision: "approve",
      p_reason: null,
      p_claim_generation: lease.claim_generation,
      p_claim_nonce: lease.claim_nonce,
    },
    reviewer
  );
  const badges = await readFoundationPostAffiliations(publicApi, { post_ids: [business.id] });
  assert.equal(badges.length, 1);
  assert.equal(badges[0].organisation_slug, slug);
  assert.equal(badges[0].logo_object_key, image.object_key);
  assert.equal(
    (await readFoundationOrganisationDirectory(publicApi)).find((x) => x.slug === slug)
      .live_businesses,
    1
  );
  await call(
    "org_update_affiliation",
    { p_affiliation: approved.affiliation_id, p_action: "set_type", p_value: "member" },
    orgAdmin
  );
  assert.equal(
    (await readFoundationPostAffiliations(publicApi, { post_ids: [business.id] }))[0].label,
    "Member"
  );
  refused(
    await rpc(
      "org_update_affiliation",
      { p_affiliation: approved.affiliation_id, p_action: "revoke", p_value: "no" },
      orgAdmin.token
    ),
    400,
    "reason_required"
  );
  await call(
    "org_update_affiliation",
    {
      p_affiliation: approved.affiliation_id,
      p_action: "revoke",
      p_value: "Membership lapsed (synthetic).",
    },
    orgAdmin
  );
  assert.deepEqual(
    await readFoundationPostAffiliations(publicApi, { post_ids: [business.id] }),
    []
  );
  assert.equal(
    sql(
      "select count(*) from private.notifications where account_id='" +
        owner.id +
        "' and kind='organisation_affiliation_ended';"
    ),
    "1"
  );
  await call(
    "update_organisation",
    { p_id: org, p_expected_revision: 3, p_patch: { is_public: false }, p_reason: reason },
    await commercial.refresh()
  );
  assert.equal(await readFoundationPublicOrganisation(publicApi, { slug }), null);
  record("native-organisations-badges-only-live-listed-active-and-revocation-notifies");

  stage("organisations staff view, audit and removal");
  const view = (await staff("staff_get_organisation", { p_id: org })).data;
  assert.equal(view.admins.length, 1);
  assert.equal(JSON.stringify(view).includes(email(unverified)), false);
  assert.equal(view.open_invites.length, 1);
  assert.equal(
    (await staff("add_organisation_note", { p_org: org, p_note: "Synthetic follow-up call." }))
      .status,
    200
  );
  assert.ok(
    Number(
      sql("select count(*) from private.organisation_events where organisation_id='" + org + "';")
    ) >= 8
  );
  sqlFails(
    "update private.organisation_events set reason='x' where organisation_id='" + org + "';",
    "23514"
  );
  for (const who of [orgAdmin, owner])
    assert.equal((await rpc("staff_get_organisation", { p_id: org }, who.token)).status, 403);
  assert.equal(
    (
      await staff("remove_organisation_admin", {
        p_org: org,
        p_account: orgAdmin.id,
        p_reason: reason,
      })
    ).status,
    200
  );
  await assert.rejects(
    readFoundationOrganisationApplications(typed(orgAdmin), { organisation_id: org })
  );
  record("native-organisations-staff-view-masks-invites-append-only-audit-and-admin-removal");
}
