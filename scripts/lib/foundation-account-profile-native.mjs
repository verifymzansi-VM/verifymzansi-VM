import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import {
  FoundationProfileError,
  readFoundationAccountProfile,
  saveFoundationAccountProfile,
  saveFoundationLegalNameClaim,
  setFoundationAvatar,
} from "../../src/lib/foundation/account-profile.ts";
import { isPersonName } from "../../src/lib/foundation/person-name.ts";
import rule from "../../src/lib/foundation/person-name-ranges.json" with { type: "json" };

// Synthetic local proof of account profiles; no provider or hosted project.
export async function testAccountProfiles({
  createUser,
  rpc,
  sql,
  sqlFails,
  verificationFixture,
  record,
  connection,
}) {
  const owner = await createUser("profile-owner");
  const other = await createUser("profile-other");
  const typed = (user) => createFoundationAuthenticatedApi(connection, user.token);
  const call = async (name, body, user = owner) => {
    const result = await rpc(name, body, user?.token ?? null);
    assert.equal(result.status, 200, "profile " + name);
    return result.data;
  };
  const rejects = async (promise, reason) =>
    assert.rejects(
      promise,
      (error) => error instanceof FoundationProfileError && error.reason === reason
    );

  // Every code point boundary of the shared table, in SQL, matches the app.
  const probes = [];
  for (const [low, high] of rule.ranges)
    for (const code of [low - 1, low, high, high + 1])
      if (code >= 0x21 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff)) probes.push(code);
  const unique = [...new Set(probes)];
  const sqlVerdicts = sql(
    "select string_agg(case when internal.person_name_valid(chr(c)||'a') then '1' else '0' end,'' order by o)" +
      " from unnest(array[" +
      unique.join(",") +
      "]) with ordinality u(c,o);"
  );
  const appVerdicts = unique
    .map((code) => (isPersonName(String.fromCodePoint(code) + "a") ? "1" : "0"))
    .join("");
  assert.equal(sqlVerdicts, appVerdicts);
  record("native-profile-name-rule-sql-app-parity", { codePoints: unique.length });

  // Signup trigger keeps only a valid, unreserved metadata display name.
  const signups = [
    ["Thando Dlamini", "Thando Dlamini"],
    ["  Zoë  ", "Zoë"],
    ["Thando  Dlamini", null],
    ["Site Admin", null],
    ["Line\nBreak", null],
  ];
  const signupIds = [];
  try {
    for (const [requested, expected] of signups) {
      const id = randomUUID();
      signupIds.push(id);
      sql(
        "insert into auth.users(id,email,raw_user_meta_data,is_anonymous) values('" +
          id +
          "','profile-signup-" +
          id +
          "@example.invalid'," +
          "jsonb_build_object('display_name'," +
          "convert_from(decode('" +
          Buffer.from(requested).toString("hex") +
          "','hex'),'UTF8')),false);"
      );
      assert.equal(
        sql(
          "select coalesce(display_name,'<null>') from private.profiles where account_id='" +
            id +
            "';"
        ),
        expected ?? "<null>"
      );
    }
  } finally {
    if (signupIds.length)
      sql("delete from auth.users where id in ('" + signupIds.join("','") + "');");
  }
  assert.equal(
    sql(
      "select count(*) from private.profiles where account_id in ('" + signupIds.join("','") + "');"
    ),
    "0"
  );
  record("native-profile-signup-trigger-validates-metadata-and-cascades-deletion");

  let profile = await readFoundationAccountProfile(typed(owner));
  assert.equal(profile.legal_name_locked, false);
  assert.equal(profile.identity_verified, false);
  for (const service of [false, true])
    assert.ok([401, 403].includes((await rpc("get_my_profile", {}, null, service)).status));
  assert.notEqual(
    (
      await rpc(
        "save_my_profile",
        {
          p_expected_revision: profile.revision,
          p_display_name: "Other Name",
          p_bio: null,
          p_owner: other.id,
        },
        owner.token
      )
    ).status,
    200
  );
  sql("update auth.users set email_confirmed_at=null where id='" + owner.id + "';");
  try {
    assert.equal((await rpc("get_my_profile", {}, owner.token)).status, 403);
  } finally {
    sql("update auth.users set email_confirmed_at=clock_timestamp() where id='" + owner.id + "';");
  }
  record("native-profile-caller-bound-and-confirmed-email-required");

  profile = await saveFoundationAccountProfile(typed(owner), {
    expected_revision: profile.revision,
    display_name: " Thando Dlamini ",
    bio: "Local seller.\nSynthetic.",
  });
  assert.equal(profile.display_name, "Thando Dlamini");
  assert.equal(profile.public_name, "Thando D.");
  const replay = await saveFoundationAccountProfile(typed(owner), {
    expected_revision: profile.revision,
    display_name: "Thando Dlamini",
    bio: "Local seller.\nSynthetic.",
  });
  assert.equal(replay.revision, profile.revision, "Unchanged input must not advance the revision");
  await rejects(
    saveFoundationAccountProfile(typed(owner), {
      expected_revision: profile.revision - 1,
      display_name: "Thando Other",
    }),
    "changed"
  );
  for (const [p_display_name, detail] of [
    ["Tab\tName", "display_name_invalid"],
    ["A".repeat(51), "display_name_invalid"],
    ["VerifyMzansi Team", "display_name_reserved"],
    ["Official Seller", "display_name_reserved"],
  ]) {
    const refused = await rpc(
      "save_my_profile",
      { p_expected_revision: profile.revision, p_display_name, p_bio: null },
      owner.token
    );
    assert.equal(refused.status, 400);
    assert.equal(refused.data.details, detail);
  }
  const unsafeBio = await rpc(
    "save_my_profile",
    { p_expected_revision: profile.revision, p_display_name: "Thando Dlamini", p_bio: "a\u202eb" },
    owner.token
  );
  assert.equal(unsafeBio.data.details, "bio_invalid");
  sqlFails(
    "update private.profiles set display_name='x' where account_id='" + owner.id + "';",
    "23514"
  );
  record("native-profile-edit-validation-revision-fence-and-idempotent-replay");

  // Identity registration requires the subject's own legal-name claim.
  const unnamed = await createUser("profile-unnamed");
  await assert.rejects(verificationFixture.identity(unnamed, { claimLegalName: false }));
  assert.equal(
    sql(
      "select count(*) from private.verification_identity_submissions where owner_id='" +
        unnamed.id +
        "';"
    ),
    "0"
  );
  profile = await saveFoundationLegalNameClaim(typed(owner), {
    expected_revision: profile.revision,
    first_name: "Thandeka",
    last_name: "Dlamini-Zulu",
  });
  assert.equal(profile.legal_name_locked, false);
  sqlFails(
    "update private.profiles set legal_name_locked_at=clock_timestamp(),legal_name_fact_id='" +
      randomUUID() +
      "',display_name=legal_first_name||' '||legal_last_name where account_id='" +
      owner.id +
      "';",
    "23514"
  );
  record("native-profile-identity-submission-requires-claim-and-lock-needs-accepted-fact");

  const accepted = await verificationFixture.identity(owner);
  profile = await readFoundationAccountProfile(typed(owner));
  assert.equal(profile.legal_name_locked, true);
  assert.equal(profile.identity_verified, true);
  assert.equal(profile.display_name, "Thandeka Dlamini-Zulu");
  assert.equal(profile.public_name, "Thandeka D.");
  assert.equal(
    sql("select legal_name_fact_id from private.profiles where account_id='" + owner.id + "';"),
    accepted.factId
  );
  await rejects(
    saveFoundationLegalNameClaim(typed(owner), {
      expected_revision: profile.revision,
      first_name: "Other",
      last_name: "Name",
    }),
    "locked"
  );
  await rejects(
    saveFoundationAccountProfile(typed(owner), {
      expected_revision: profile.revision,
      display_name: "Other Name",
    }),
    "locked"
  );
  profile = await saveFoundationAccountProfile(typed(owner), {
    expected_revision: profile.revision,
    display_name: null,
    bio: null,
  });
  assert.equal(profile.bio, null);
  assert.equal(profile.display_name, "Thandeka Dlamini-Zulu");
  for (const statement of [
    "update private.profiles set legal_first_name='Other' where account_id='" + owner.id + "';",
    "update private.profiles set legal_name_locked_at=null,legal_name_fact_id=null where account_id='" +
      owner.id +
      "';",
    "update private.identity_submission_names set legal_first_name='Other' where owner_id='" +
      owner.id +
      "';",
  ])
    sqlFails(statement, "23514");
  record("native-profile-accepted-identity-propagates-and-locks-reviewed-names");

  // Avatar: own ready image only; the link protects it from media cleanup.
  const upload = async (user) => {
    const begun = await call("begin_media_upload", { p_kind: "image", p_bytes: 1000 }, user);
    const id = begun.object_id;
    const finalized = await rpc(
      "finalize_media",
      {
        p_object_id: id,
        p_size: 900,
        p_sha256: "c".repeat(64),
        p_mime: "image/webp",
        p_width: 64,
        p_height: 64,
      },
      null,
      true
    );
    assert.equal(finalized.status, 200);
    sql(
      "update private.media_objects set created_at=statement_timestamp()-interval '2 days' where id='" +
        id +
        "';"
    );
    return id;
  };
  const mine = await upload(owner);
  const theirs = await upload(other);
  await rejects(
    setFoundationAvatar(typed(owner), { expected_revision: profile.revision, object_id: theirs }),
    "avatar_unavailable"
  );
  profile = await setFoundationAvatar(typed(owner), {
    expected_revision: profile.revision,
    object_id: mine,
  });
  assert.equal(profile.avatar_object_id, mine);
  const inUse = (id) => sql("select internal.media_object_in_use('" + id + "');");
  assert.equal(inUse(mine), "t", "Linked avatar must be protected from media cleanup");
  assert.equal(inUse(theirs), "f");
  profile = await setFoundationAvatar(typed(owner), {
    expected_revision: profile.revision,
    object_id: null,
  });
  assert.equal(
    sql("select unlinked_at is not null from private.media_objects where id='" + mine + "';"),
    "t"
  );
  record("native-profile-avatar-owner-bound-and-cleanup-protected");

  // First administrator bootstrap: operator SQL only, once, MFA required.
  const bootstrap = (email) =>
    sql(
      "begin; delete from private.staff_roles; select internal.bootstrap_first_administrator('" +
        email +
        "')::text; rollback;"
    );
  assert.throws(
    () => sql("select internal.bootstrap_first_administrator('nobody@example.invalid');"),
    (error) => /staff roles are already initialised/.test(String(error.stderr))
  );
  const ownerEmail = sql("select email from auth.users where id='" + owner.id + "';");
  assert.throws(
    () => bootstrap(ownerEmail),
    (error) => /verified authenticator app required/.test(String(error.stderr))
  );
  assert.throws(
    () => bootstrap("missing-" + randomUUID() + "@example.invalid"),
    (error) => /confirmed active account required/.test(String(error.stderr))
  );
  const totpEmail = sql(
    "select u.email from auth.users u join auth.mfa_factors f on f.user_id=u.id" +
      " where f.factor_type='totp' and f.status='verified' order by u.created_at limit 1;"
  );
  assert.match(bootstrap(totpEmail), /"role": "admin"/);
  for (const role of ["anon", "authenticated", "service_role"])
    assert.equal(
      sql(
        "select has_function_privilege('" +
          role +
          "','internal.bootstrap_first_administrator(text)','execute');"
      ),
      "f"
    );
  record("native-profile-first-admin-bootstrap-operator-only-once-with-mfa");
}
