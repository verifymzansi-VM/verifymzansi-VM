#!/usr/bin/env node
// Behaviour checks for 20261120040242_signup_mode_member_invitations.sql: the
// sign-up mode held in the database (only the database owner changes it,
// with an append-only record), member invitations kept apart from
// administrator invitations, the sign-up hook in both modes (invitations,
// reserved and blocked email domains) and the retention of member
// invitations.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, runs the update's read-only preflight, checks that drift and a
// premature rollback are refused, applies the update, proves apply -> rollback
// -> apply returns the same fingerprints, then checks the hook as the Auth
// service role, the owner-only mode change, the staff commands as synthetic
// members and staff, that a member invitation never makes an administrator
// while an administrator invitation still does, and retention. Any later
// updates are applied at the end and the hook is checked again.
//
//   node --import tsx scripts/test-foundation-signup-mode.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Auth
// users, sessions and authenticator apps are written directly as the database
// owner; nothing contacts Auth or sends mail.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
  sqlJsonb as jsonb,
  sqlLiteral as lit,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261120040242_signup_mode_member_invitations.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const HOOK = "internal.acceptance_signup_guard(jsonb)";
const CLOSED = { error: { http_code: 403, message: "Registration is not open yet" } };
const DOMAIN_REFUSED = {
  error: { http_code: 403, message: "Registration is not available for this email address" },
};

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  member,
  staff,
  as,
  claims,
  service,
  fingerprint,
  preflightRows: preflight,
  bodyMd5,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ------------------------------------------------------ synthetic world
  q(`create schema vmtest;
    create function vmtest.account(p_email text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_email,now(),jsonb_build_object('display_name','Fixture Person'));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid,'email',p_email);
    end$$;
    create function vmtest.staff(p_email text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.account(p_email); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role);
      return m;
    end$$;
    -- Thirty-one days pass for one closed account.
    create function vmtest.erasure_due(p_user uuid) returns void language plpgsql as $$
    begin
      update private.account_erasures set closed_at=closed_at-interval '31 days',erase_after=erase_after-interval '31 days'
        where user_id=p_user;
      update private.account_closures set closed_at=closed_at-interval '31 days',
        evidence_delete_after=evidence_delete_after-interval '31 days' where user_id=p_user;
    end$$;`);
  const account = (email) => json(`select vmtest.account(${lit(email)});`);
  const staffAccount = (email, role) => json(`select vmtest.staff(${lit(email)},${lit(role)});`);
  /** The hook's answer for `email` (or a whole event), as the Auth service role. */
  const hook = (event) =>
    json(
      `set role supabase_auth_admin;\nselect internal.acceptance_signup_guard(${jsonb(
        typeof event === "string" ? { user: { email: event } } : event
      )});`
    );
  const owner = staffAccount("owner-admin@example.invalid", "admin");
  const moderator = staffAccount("moderator@example.invalid", "moderator");
  const plain = account("plain-member@example.invalid");
  q(`insert into private.owner_admin_invitations(email) values ('future-admin@example.invalid'),
      ('existing-admin@example.invalid');`);
  // An administrator invitation already used to sign up before the update.
  const existingAdmin = account("existing-admin@example.invalid");
  // An administrator invitation already claimed, whose account later moved to
  // another address.
  const claimedAdmin = account("claimed-admin@example.invalid");
  q(`insert into private.owner_admin_invitations(email,claimed_by,claimed_at)
      values ('claimed-admin@example.invalid','${claimedAdmin.id}',now());
    update auth.users set email='claimed-moved@example.invalid' where id='${claimedAdmin.id}';`);

  // ------------------------------------------------------------ before
  await check("before the update: preflight reads 'not applied' and is read only", () => {
    assert.deepEqual(preflight(), [
      [
        "summary",
        "signup mode and member invitations: update not applied; administrator invitations not yet used: 2",
      ],
    ]);
    assertReadOnlyPreflight(database, PREFLIGHT);
  });

  await check("drift and a premature rollback are refused, changing nothing", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    const live = q(`select pg_get_functiondef('${HOOK}'::regprocedure);`);
    // The same hook with one more space at the start of its body.
    q(
      `do $$begin execute replace(pg_get_functiondef('${HOOK}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[1][1], /acceptance_signup_guard\(jsonb\) is not the reviewed body/);
    assert.match(
      fails(step.sql, "55000"),
      /acceptance_signup_guard\(jsonb\) .* is not a reviewed body/
    );
    q(`${live};`);
    // One of the update's tables already present: a partial state.
    q(`create table private.member_invitations(email text primary key);`);
    assert.equal(
      preflight()[0][1],
      "signup mode and member invitations: unexpected state; administrator invitations not yet used: 2"
    );
    assert.match(fails(step.sql, "55000"), /signup mode precondition: 1 of 21/);
    q(`drop table private.member_invitations;`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  await check("apply, roll back and apply again are clean", () =>
    applyWithRollbackCheck(database, {
      step,
      rollback: ROLLBACK,
      label: "signup mode",
      fingerprint,
      preflightRows: preflight,
      appliedSummary:
        /^signup mode and member invitations: already applied; mode: invite_only; mode changes recorded: 0; member invitations open: 0; blocked domains: 15; administrator invitations not yet used: 2$/,
    })
  );
  // Production grants this when the hook is switched on in the dashboard
  // (replay/hosted-auth-hook-grants.sql).
  q("grant usage on schema internal to supabase_auth_admin;");

  await check("an administrator invitation used before the update counts as signed up", () => {
    assert.equal(
      q(
        `select signed_up_by from private.owner_admin_invitations where email='existing-admin@example.invalid';`
      ),
      existingAdmin.id
    );
    assert.equal(
      q(`select count(*) from private.owner_admin_invitations where signed_up_at is not null;`),
      "2"
    );
    // A claimed invitation is filled from its claim, so its address admits no
    // further sign-up after the account moved away.
    assert.equal(
      q(
        `select signed_up_by from private.owner_admin_invitations where email='claimed-admin@example.invalid';`
      ),
      claimedAdmin.id
    );
    assert.equal(hook("claimed-admin@example.invalid").error.http_code, 403);
  });

  // ------------------------------------------------------------- hook
  await check("invite only (the default): only invited addresses are admitted", () => {
    assert.deepEqual(json("select internal.get_signup_mode();"), { mode: "invite_only" });
    q(`insert into private.member_invitations(email) values ('invited-member@example.invalid'),
        ('old-member@example.invalid'),('revoked-member@example.invalid');
      update private.member_invitations set invited_at=now()-interval '40 days',expires_at=now()-interval '10 days'
        where email='old-member@example.invalid';
      update private.member_invitations set revoked_at=now() where email='revoked-member@example.invalid';`);
    assert.deepEqual(hook("someone@gmail.com"), CLOSED);
    assert.deepEqual(hook("future-admin@example.invalid"), {});
    assert.deepEqual(hook("FUTURE-ADMIN@example.invalid"), {});
    assert.deepEqual(hook("invited-member@example.invalid"), {});
    assert.deepEqual(
      hook({
        user: { email: "Invited-Member@Example.invalid", app_metadata: { provider: "google" } },
      }),
      {}
    );
    assert.deepEqual(hook("old-member@example.invalid"), CLOSED);
    assert.deepEqual(hook("revoked-member@example.invalid"), CLOSED);
    assert.deepEqual(hook({}), CLOSED);
    assert.deepEqual(hook({ user: { email: null, phone: "+27820000000" } }), CLOSED);
    assert.deepEqual(hook({ user: { email: ["invited-member@example.invalid"] } }), CLOSED);
    // Metadata never matters.
    assert.deepEqual(
      hook({ user: { email: "x@gmail.com", user_metadata: { role: "admin" } } }),
      CLOSED
    );
  });

  await check("the hook keeps invoker rights and stays closed to every API role", () => {
    assert.equal(q(`select prosecdef from pg_proc where oid='${HOOK}'::regprocedure;`), "f");
    assert.deepEqual(executeGrants(json, [HOOK])[HOOK], {
      anon: false,
      authenticated: false,
      service_role: false,
    });
    // The Auth role reads only the columns the hook needs.
    fails(
      "set role supabase_auth_admin;\nselect invited_by from private.member_invitations limit 1;",
      "42501"
    );
    fails(
      "set role supabase_auth_admin;\nselect changed_at from private.signup_settings;",
      "42501"
    );
    fails("set role supabase_auth_admin;\nselect * from private.signup_mode_events;", "42501");
    fails(
      "set role supabase_auth_admin;\nselect * from private.member_invitation_events;",
      "42501"
    );
    fails(
      "set role supabase_auth_admin;\nselect claimed_by from private.member_invitations limit 1;",
      "42501"
    );
    fails(
      "set role supabase_auth_admin;\nselect signed_up_by from private.owner_admin_invitations limit 1;",
      "42501"
    );
    assert.equal(hook("existing-admin@example.invalid").error.http_code, 403);
  });

  // ---------------------------------------------------- owner-only mode
  await check("only the database owner changes the mode, with a reason and a named admin", () => {
    const sig = "internal.set_signup_mode(text,text,text)";
    assert.deepEqual(executeGrants(json, [sig])[sig], {
      anon: false,
      authenticated: false,
      service_role: false,
    });
    fails(
      member(
        plain,
        "select internal.set_signup_mode('open','Launch day','owner-admin@example.invalid');"
      ),
      "42501"
    );
    fails(
      staff(
        owner,
        "select internal.set_signup_mode('open','Launch day','owner-admin@example.invalid');"
      ),
      "42501"
    );
    fails(
      service(
        "select internal.set_signup_mode('open','Launch day','owner-admin@example.invalid');"
      ),
      "42501"
    );
    const set = (mode, reason, email) =>
      `select internal.set_signup_mode(${lit(mode)},${reason === null ? "null" : lit(reason)},${lit(email)});`;
    fails(
      set("public", "Launch day", "owner-admin@example.invalid"),
      "22023",
      /signup_mode_invalid/
    );
    fails(set("open", "No", "owner-admin@example.invalid"), "22023", /signup_mode_reason_required/);
    fails(set("open", null, "owner-admin@example.invalid"), "22023", /signup_mode_reason_required/);
    fails(
      set("open", "Launch\nday", "owner-admin@example.invalid"),
      "22023",
      /signup_mode_reason_required/
    );
    fails(
      set("open", "Launch day", "moderator@example.invalid"),
      "42501",
      /signup_mode_changer_invalid/
    );
    fails(
      set("open", "Launch day", "plain-member@example.invalid"),
      "42501",
      /signup_mode_changer_invalid/
    );
    fails(
      set("open", "Launch day", "nobody@example.invalid"),
      "42501",
      /signup_mode_changer_invalid/
    );
    const noApp = staffAccount("admin-without-app@example.invalid", "admin");
    q(`delete from auth.mfa_factors where user_id='${noApp.id}';`);
    fails(
      set("open", "Launch day", "admin-without-app@example.invalid"),
      "42501",
      /signup_mode_changer_invalid/
    );
    assert.equal(q("select count(*) from private.signup_mode_events;"), "0");
    assert.deepEqual(json(set("invite_only", "Already closed", "owner-admin@example.invalid")), {
      mode: "invite_only",
      changed: false,
    });
    assert.equal(q("select count(*) from private.signup_mode_events;"), "0");
    assert.deepEqual(
      json(set("open", "  Launch day: public sign-up  ", " Owner-Admin@example.invalid ")),
      {
        mode: "open",
        changed: true,
      }
    );
    assert.deepEqual(
      json(
        "select jsonb_agg(jsonb_build_object('from',from_mode,'to',to_mode,'by',changed_by,'reason',reason)) from private.signup_mode_events;"
      ),
      [{ from: "invite_only", to: "open", by: owner.id, reason: "Launch day: public sign-up" }]
    );
    q("set role anon;\nselect api.get_signup_mode();");
    assert.deepEqual(json("set role anon;\nselect api.get_signup_mode();"), { mode: "open" });
    assert.deepEqual(json(member(plain, "select api.get_signup_mode();")), { mode: "open" });
    fails(service("select api.get_signup_mode();"), "42501");
  });

  await check("the mode row and its record cannot be changed around the command", () => {
    fails("update private.signup_settings set mode='invite_only';", "42501");
    fails("delete from private.signup_settings;", "42501");
    fails("truncate private.signup_settings;", "42501");
    fails("update private.signup_mode_events set reason='Rewritten reason';", "23514");
    fails("delete from private.signup_mode_events;", "23514");
    fails("truncate private.signup_mode_events;", "23514");
    assert.deepEqual(json("select internal.get_signup_mode();"), { mode: "open" });
    for (const role of ["anon", "authenticated", "service_role"])
      for (const table of [
        "signup_settings",
        "signup_mode_events",
        "member_invitations",
        "signup_blocked_domains",
      ])
        assert.equal(
          q(`select has_table_privilege('${role}','private.${table}','select');`),
          "f",
          `${role} ${table}`
        );
  });

  await check("open: everyone is admitted except reserved, malformed and blocked domains", () => {
    for (const email of [
      "someone@gmail.com",
      "Thandi@Company.co.za",
      "a@b.co",
      "x@xn--bcher-kva.example.co.za",
    ])
      assert.deepEqual(hook(email), {}, email);
    for (const email of [
      "x@mailinator.com",
      "x@MAILINATOR.com",
      "x@inbox.mailinator.com",
      "x@yopmail.com",
      "x@foo.test",
      "x@foo.invalid",
      "x@localhost",
      "x@host.local",
      "x@example.com",
      "x@mail.example",
      "x@[192.0.2.1]",
      "x@192.0.2.1",
      "x@nodot",
      "x@-bad.com",
      "x@under_score.com",
      "x@",
      "no-at-sign",
    ])
      assert.deepEqual(hook(email), DOMAIN_REFUSED, email);
    // A lookalike that only ends in a blocked name is not blocked.
    assert.deepEqual(hook("x@notmailinator.com"), {});
    // Invitations still admit, whatever the domain.
    q(`insert into private.member_invitations(email) values ('tester@lab.test');`);
    assert.deepEqual(hook("tester@lab.test"), {});
    assert.deepEqual(hook("future-admin@example.invalid"), {});
    // The owner can block another domain.
    q(
      `insert into private.signup_blocked_domains(domain,reason) values ('farm.example.co.za','abuse');`
    );
    assert.deepEqual(hook("bot@farm.example.co.za"), DOMAIN_REFUSED);
    assert.deepEqual(hook("bot@a.farm.example.co.za"), DOMAIN_REFUSED);
    // Back to invite only: the same open addresses are refused again.
    assert.deepEqual(
      json(
        "select internal.set_signup_mode('invite_only','Pause after launch','owner-admin@example.invalid');"
      ),
      { mode: "invite_only", changed: true }
    );
    assert.deepEqual(hook("someone@gmail.com"), CLOSED);
    assert.deepEqual(hook("x@mailinator.com"), CLOSED);
    assert.deepEqual(hook("tester@lab.test"), {});
    assert.equal(
      q("select string_agg(to_mode,',' order by changed_at) from private.signup_mode_events;"),
      "open,invite_only"
    );
  });

  // -------------------------------------------------- member invitations
  await check("member invitation commands: admin only, with the 12-hour authenticator rule", () => {
    const invite = (who, email) => `select api.invite_member(${lit(email)});`;
    fails(`set role anon;\n${invite(null, "a@example.co.za")}`, "42501");
    fails(member(plain, invite(plain, "a@example.co.za")), "42501", /staff session/);
    fails(
      staff(moderator, invite(moderator, "a@example.co.za")),
      "42501",
      /capability not granted/
    );
    fails(service(invite(null, "a@example.co.za")), "42501");
    fails(
      staff(owner, invite(owner, "a@example.co.za"), Math.floor(Date.now() / 1000) - 13 * 3600),
      "42501",
      /second-factor verification expired/
    );
    // An authenticator code from 30 minutes ago is enough (no 15-minute rule).
    const first = json(
      staff(
        owner,
        invite(owner, "  New.Person@Example.CO.ZA "),
        Math.floor(Date.now() / 1000) - 1800
      )
    );
    assert.equal(first.email, "new.person@example.co.za");
    assert.ok(Date.parse(first.expires_at) - Date.parse(first.invited_at) === 30 * 86400 * 1000);
    for (const bad of [
      "",
      "no-at",
      "a@b",
      "a b@c.com",
      "@c.com",
      "a@@c.com",
      `${"x".repeat(250)}@c.com`,
    ])
      fails(staff(owner, invite(owner, bad)), "22023", /member_invitation_email_invalid/);
    fails(staff(owner, "select api.invite_member(null);"), "22023");
    // An address that already has an account is refused, whatever its case.
    for (const existing of ["plain-member@example.invalid", "PLAIN-Member@example.invalid"])
      fails(
        staff(owner, `select api.invite_member(${lit(existing)});`),
        "PT409",
        /This person already has an account\./
      );
    assert.match(
      fails(staff(owner, "select api.invite_member('plain-member@example.invalid');"), "PT409"),
      /member_invitation_account_exists/
    );
    assert.equal(
      q(
        `select count(*) from private.member_invitations where email='plain-member@example.invalid';`
      ),
      "0"
    );
    assert.deepEqual(hook("new.person@example.co.za"), {});
    assert.deepEqual(
      json(staff(owner, "select api.revoke_member_invitation('NEW.PERSON@example.co.za');")),
      { email: "new.person@example.co.za", revoked: true }
    );
    assert.deepEqual(
      json(staff(owner, "select api.revoke_member_invitation('new.person@example.co.za');")),
      { email: "new.person@example.co.za", revoked: false }
    );
    fails(
      staff(moderator, "select api.revoke_member_invitation('new.person@example.co.za');"),
      "42501"
    );
    assert.deepEqual(hook("new.person@example.co.za"), CLOSED);
    // Inviting again reopens it for another 30 days.
    json(staff(owner, invite(owner, "new.person@example.co.za")));
    assert.deepEqual(hook("new.person@example.co.za"), {});
    // The old invitation: inviting again renews it.
    json(staff(owner, invite(owner, "old-member@example.invalid")));
    assert.deepEqual(hook("old-member@example.invalid"), {});
  });

  await check("the list shows status and whether an account exists, never who invited", () => {
    account("invited-member@example.invalid");
    const list = json(staff(owner, "select api.list_member_invitations();")).items;
    const byEmail = Object.fromEntries(list.map((item) => [item.email, item]));
    assert.deepEqual(Object.keys(list[0]).sort(), [
      "claimed_at",
      "email",
      "expires_at",
      "invited_at",
      "registered",
      "revoked_at",
      "status",
    ]);
    assert.equal(byEmail["invited-member@example.invalid"].status, "used");
    assert.equal(byEmail["invited-member@example.invalid"].registered, true);
    assert.ok(byEmail["invited-member@example.invalid"].claimed_at);
    assert.equal(byEmail["new.person@example.co.za"].status, "open");
    assert.equal(byEmail["revoked-member@example.invalid"].status, "revoked");
    assert.equal(byEmail["new.person@example.co.za"].registered, false);
    q(`update private.member_invitations set invited_at=now()-interval '31 days',expires_at=now()-interval '1 day'
      where email='tester@lab.test';`);
    assert.equal(
      json(staff(owner, "select api.list_member_invitations();")).items.find(
        (i) => i.email === "tester@lab.test"
      ).status,
      "expired"
    );
    fails(staff(moderator, "select api.list_member_invitations();"), "42501");
    fails(member(plain, "select api.list_member_invitations();"), "42501");
  });

  await check("every invitation, renewal and revocation is recorded, append-only", () => {
    assert.deepEqual(
      json(`select jsonb_agg(jsonb_build_object('email',email,'action',action,'by',actor_id) order by created_at,action)
        from private.member_invitation_events;`),
      [
        { email: "new.person@example.co.za", action: "invite", by: owner.id },
        { email: "new.person@example.co.za", action: "revoke", by: owner.id },
        { email: "new.person@example.co.za", action: "renew", by: owner.id },
        { email: "old-member@example.invalid", action: "renew", by: owner.id },
      ]
    );
    fails("update private.member_invitation_events set action='invite';", "23514");
    fails("delete from private.member_invitation_events;", "23514");
    fails("truncate private.member_invitation_events;", "23514");
  });

  await check(
    "at most 200 invitations per staff member in 24 hours, counted from their events",
    () => {
      // LIM-SQL-member-invitations-day (docs/testing/limits-register.json)
      // Three today (an invitation and two renewals) plus 196.
      q(`insert into private.member_invitation_events(email,action,actor_id)
      select 'bulk-'||g||'@example.co.za','invite','${owner.id}' from generate_series(1,196) g;`);
      json(staff(owner, "select api.invite_member('number-200@example.co.za');"));
      fails(
        staff(owner, "select api.invite_member('number-201@example.co.za');"),
        "54000",
        /member_invitation_limit/
      );
      // Another admin is not held back by the first one's invitations, and
      // renewing the first one's invitation does not free the first one's count.
      const second = staffAccount("second-admin@example.invalid", "admin");
      json(staff(second, "select api.invite_member('number-201@example.co.za');"));
      json(staff(second, "select api.invite_member('number-200@example.co.za');"));
      assert.equal(
        q(
          `select invited_by from private.member_invitations where email='number-200@example.co.za';`
        ),
        second.id
      );
      fails(
        staff(owner, "select api.invite_member('number-202@example.co.za');"),
        "54000",
        /member_invitation_limit/
      );
      // The synthetic events go again (as only the retention job may), so the
      // later checks start below the limit.
      q(`begin; select set_config('vm.retention','on',true);
        delete from private.member_invitation_events where email like 'bulk-%'; commit;`);
    }
  );

  await check(
    "a member invitation never makes an administrator; an administrator invitation still does",
    () => {
      const invitedMember = account("invited-member-2@example.invalid");
      q(
        `insert into private.member_invitations(email) values ('invited-member-2@example.invalid');`
      );
      q(
        `insert into auth.mfa_factors(user_id,factor_type,status) values('${invitedMember.id}','totp','verified');`
      );
      assert.equal(
        q(`select count(*) from private.staff_roles where user_id='${invitedMember.id}';`),
        "0"
      );
      const futureAdmin = account("future-admin@example.invalid");
      q(
        `insert into auth.mfa_factors(user_id,factor_type,status) values('${futureAdmin.id}','totp','verified');`
      );
      assert.equal(
        q(
          `select role from private.staff_roles where user_id='${futureAdmin.id}' and revoked_at is null;`
        ),
        "admin"
      );
      // Neither command ever touches the administrator list.
      assert.equal(q("select count(*) from private.owner_admin_invitations;"), "3");
    }
  );

  await check("an invitation admits one sign-up: not again after an email change", () => {
    json(staff(owner, "select api.invite_member('once@example.co.za');"));
    assert.deepEqual(hook("once@example.co.za"), {});
    const once = account("once@example.co.za");
    assert.equal(
      q(`select claimed_by from private.member_invitations where email='once@example.co.za';`),
      once.id
    );
    assert.deepEqual(hook("once@example.co.za"), CLOSED);
    q(`update auth.users set email='moved-away@example.co.za' where id='${once.id}';`);
    assert.deepEqual(hook("once@example.co.za"), CLOSED);
    const item = json(staff(owner, "select api.list_member_invitations();")).items.find(
      (i) => i.email === "once@example.co.za"
    );
    assert.equal(item.status, "used");
    assert.equal(item.registered, true);
    // Only a staff renewal makes it usable again.
    json(staff(owner, "select api.invite_member('once@example.co.za');"));
    assert.deepEqual(hook("once@example.co.za"), {});
  });

  await check("an invitation admits one sign-up: not again after the account is erased", () => {
    json(staff(owner, "select api.invite_member('gone@example.co.za');"));
    const gone = account("gone@example.co.za");
    assert.deepEqual(hook("gone@example.co.za"), CLOSED);
    json(
      as(
        {
          ...claims(gone),
          amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - 60 }],
        },
        "select api.close_my_account();"
      )
    );
    q(`select vmtest.erasure_due('${gone.id}');`);
    const erased = json(`select internal.erase_closed_account('${gone.id}','sweep');`);
    assert.ok(erased.erased_at, JSON.stringify(erased));
    // The person's invitation and its history are gone with them.
    assert.equal(
      q(`select count(*) from private.member_invitations where email='gone@example.co.za';`),
      "0"
    );
    assert.equal(
      q(`select count(*) from private.member_invitation_events where email='gone@example.co.za';`),
      "0"
    );
    assert.deepEqual(hook("gone@example.co.za"), CLOSED);
  });

  await check(
    "an administrator invitation admits one sign-up and is claimed only by that account",
    () => {
      q(
        `insert into private.owner_admin_invitations(email) values ('admin-once@example.invalid');`
      );
      const first = account("admin-once@example.invalid");
      assert.deepEqual(hook("admin-once@example.invalid"), CLOSED);
      // The first account moves away and another takes the address: the other
      // account enrolling an authenticator app is not made an administrator.
      q(`update auth.users set email='admin-moved@example.invalid' where id='${first.id}';`);
      assert.deepEqual(hook("admin-once@example.invalid"), CLOSED);
      const other = account("other-person@example.invalid");
      q(`update auth.users set email='admin-once@example.invalid' where id='${other.id}';
      insert into auth.mfa_factors(user_id,factor_type,status) values('${other.id}','totp','verified');`);
      assert.equal(q(`select count(*) from private.staff_roles where user_id='${other.id}';`), "0");
      assert.equal(
        q(
          `select claimed_at is null from private.owner_admin_invitations where email='admin-once@example.invalid';`
        ),
        "t"
      );
      // The account that signed up with it claims it once its address is back.
      q(`update auth.users set email='other-moved@example.invalid' where id='${other.id}';
      update auth.users set email='admin-once@example.invalid' where id='${first.id}';
      insert into auth.mfa_factors(user_id,factor_type,status) values('${first.id}','totp','verified');`);
      assert.equal(
        q(
          `select role from private.staff_roles where user_id='${first.id}' and revoked_at is null;`
        ),
        "admin"
      );
    }
  );

  await check(
    "an erased account's administrator invitation is never claimed by a later account",
    () => {
      q(
        `insert into private.owner_admin_invitations(email) values ('admin-erased@example.invalid');`
      );
      const first = account("admin-erased@example.invalid");
      json(
        as(
          {
            ...claims(first),
            amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - 60 }],
          },
          "select api.close_my_account();"
        )
      );
      q(`select vmtest.erasure_due('${first.id}');`);
      assert.ok(json(`select internal.erase_closed_account('${first.id}','sweep');`).erased_at);
      // The Auth user is gone (its sign-up link is cleared), the sign-up stays.
      assert.equal(
        q(`select (signed_up_by is null and signed_up_at is not null)::text from private.owner_admin_invitations
        where email='admin-erased@example.invalid';`),
        "true"
      );
      assert.deepEqual(hook("admin-erased@example.invalid"), CLOSED);
      const later = account("admin-erased@example.invalid");
      q(
        `insert into auth.mfa_factors(user_id,factor_type,status) values('${later.id}','totp','verified');`
      );
      assert.equal(q(`select count(*) from private.staff_roles where user_id='${later.id}';`), "0");
    }
  );

  await check("the email domain check follows the sign-up mode", () => {
    const allowed = (email) =>
      json(member(plain, `select api.check_email_domain(${lit(email)});`)).allowed;
    assert.equal(allowed("x@mailinator.com"), true);
    q("select internal.set_signup_mode('open','Launch day','owner-admin@example.invalid');");
    assert.equal(allowed("x@mailinator.com"), false);
    assert.equal(allowed("x@foo.test"), false);
    assert.equal(allowed("person@gmail.com"), true);
    fails("set role anon;\nselect api.check_email_domain('x@gmail.com');", "42501");
    fails(member(plain, "select api.check_email_domain(null);"), "22023");
    q(
      "select internal.set_signup_mode('invite_only','Back to invitations','owner-admin@example.invalid');"
    );
    assert.equal(allowed("x@mailinator.com"), true);
  });

  await check("retention deletes member invitations 30 days after expiry or revocation", () => {
    q(`update private.member_invitations set invited_at=now()-interval '70 days',expires_at=now()-interval '40 days'
        where email='tester@lab.test';
      update private.member_invitations set revoked_at=now()-interval '31 days' where email='revoked-member@example.invalid';
      insert into private.member_invitations(email,invited_at,expires_at)
        values('recently-expired@example.co.za',now()-interval '40 days',now()-interval '10 days');`);
    fails("select internal.purge_member_invitations(0);", "22023");
    q(`insert into private.member_invitation_events(email,action,actor_id,created_at)
      values('ancient@example.co.za','invite','${owner.id}',now()-interval '13 months');`);
    const result = json(service("select api.run_retention(100);"));
    assert.equal(result.member_invitations, 2);
    assert.equal(
      q(`select count(*) from private.member_invitations
        where email in ('tester@lab.test','revoked-member@example.invalid');`),
      "0"
    );
    assert.equal(
      q(`select count(*) from private.member_invitations
        where email in ('recently-expired@example.co.za','invited-member@example.invalid');`),
      "2"
    );
    assert.equal(
      q(
        `select count(*) from private.member_invitation_events where email='ancient@example.co.za';`
      ),
      "0"
    );
    assert.ok(bodyMd5("internal.purge_member_invitations(integer)") !== "missing");
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the sign-up hook and member invitations", () => {
      assert.deepEqual(hook("someone@gmail.com"), CLOSED);
      assert.deepEqual(hook("invited-member@example.invalid"), CLOSED);
      assert.deepEqual(hook("recently-expired@example.co.za"), CLOSED);
      assert.deepEqual(hook("number-201@example.co.za"), {});
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Sign-up mode and member invitation checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
