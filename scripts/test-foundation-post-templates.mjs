#!/usr/bin/env node
// Behaviour checks for 20261122191646_post_templates.sql: a member whose
// Multi-listing package runs saves post templates for Market listings
// (api.save_my_post_template), lists, renames and deletes their own
// (api.list_my_post_templates, api.rename_my_post_template,
// api.delete_my_post_template); templates go when the account closes; the
// privacy export lists them.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members are written directly as the database owner (an accepted ID
// review as a synthetic identity fact); a package is bought through the
// package checkout and a synthetic Ozow notice, as the website's server does.
// The script checks the read-only preflight, a drifted body and a premature
// rollback, applies the update and proves apply -> rollback -> apply, then the
// behaviour.
//
//   node --import tsx scripts/test-foundation-post-templates.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { executeGrants, sqlLiteral } from "./lib/foundation-sql-checks.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  buyPackage as buyPackageOf,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261122191646_post_templates.sql";
const API = [
  "api.save_my_post_template(text,jsonb)",
  "api.list_my_post_templates()",
  "api.rename_my_post_template(uuid,text)",
  "api.delete_my_post_template(uuid)",
];
const INTERNAL = API.map((fn) => fn.replace(/^api\./, "internal."));
const TRIGGER_FN = "internal.clear_closed_account_post_templates()";
const NOT_APPLIED = /^post templates: update not applied; slot packages: \d+$/;
const APPLIED =
  /^post templates: already applied; slot packages: \d+; templates: \d+; accounts with templates: \d+$/;

const SETUP = { update: UPDATE, label: "posttemplates", title: "Post templates" };
await runTwoAdminUpdateCheck(SETUP, async ({ database, check, kit, world, admin }) => {
  const { q, json, fails, member, preflight } = kit;

  const verified = (label) => world.verified(label, admin);
  const buyPackage = (owner, slots) => buyPackageOf(kit, owner, slots);
  const BAKKIE = {
    category: "vehicles",
    condition: "used",
    categoryAttributes: {
      make: "Toyota",
      model: "Hilux",
      transmission: "manual",
      fuel_type: "diesel",
    },
    description: "A synthetic description long enough for every rule.",
    province: "gauteng",
    city: "johannesburg",
    town: "Sandton",
    address: "1 Synthetic Road",
    contactMethods: ["call", "whatsapp", "in_app"],
  };
  const saveSql = (owner, name, data = BAKKIE) =>
    member(
      owner,
      `select api.save_my_post_template(${sqlLiteral(name)},${sqlLiteral(JSON.stringify(data))}::jsonb);`
    );
  const save = (owner, name, data) => json(saveSql(owner, name, data));
  const list = (owner) => json(member(owner, `select api.list_my_post_templates();`));
  const renameSql = (owner, id, name) =>
    member(owner, `select api.rename_my_post_template('${id}',${sqlLiteral(name)});`);
  const deleteSql = (owner, id) => member(owner, `select api.delete_my_post_template('${id}');`);
  const stored = (owner) =>
    Number(q(`select count(*) from private.post_templates where owner_id='${owner.id}';`));

  // ------------------------------------------------------------ before
  await check("before the update: no template commands", () => {
    assert.equal(q(`select to_regprocedure('${API[0]}') is null;`), "t");
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], NOT_APPLIED);
  });
  await check("drift and a premature rollback are refused", () => {
    assertDriftRefused(kit, {
      label: "post templates",
      signatures: ["internal.frontend_privacy_export_data(uuid)"],
      rows: 2,
    });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "post templates",
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  await check("grants: the four commands for members only; the trigger for nobody", () => {
    const grants = executeGrants(json, [...API, ...INTERNAL, TRIGGER_FN]);
    for (const fn of [...API, ...INTERNAL])
      assert.deepEqual(grants[fn], { anon: false, authenticated: true, service_role: false }, fn);
    assert.deepEqual(grants[TRIGGER_FN], {
      anon: false,
      authenticated: false,
      service_role: false,
    });
    for (const fn of API)
      assert.equal(
        q(`select prosecdef from pg_proc where oid='${fn}'::regprocedure;`),
        "f",
        `${fn} is security invoker`
      );
    assert.equal(
      q(`select relrowsecurity from pg_class where oid='private.post_templates'::regclass;`),
      "t"
    );
    fails(member(world.user("tpl-nobody"), "select * from private.post_templates;"), "42501");
    fails(`set role anon;\nselect api.list_my_post_templates();`, "42501");
    fails(`set role anon;\nselect api.save_my_post_template('x','{}'::jsonb);`, "42501");
  });

  // ------------------------------------------------------------- world
  q(
    `update private.slot_package_sales set on_sale=true,changed_at=now(),reason='Fixture: switched for the checks';`
  );
  const sipho = verified("tpl-sipho");
  buyPackage(sipho, 10);

  await check("save, replace by name, list, rename and delete", () => {
    assert.deepEqual(list(sipho), { package_running: true, templates: [] });
    const first = save(sipho, "  Used bakkie  ");
    assert.equal(first.name, "Used bakkie", "the name is trimmed");
    assert.equal(first.replaced, false);
    // Saving again under the same name (any case) replaces it.
    const again = save(sipho, "USED BAKKIE", { ...BAKKIE, description: "Second wording." });
    assert.equal(again.id, first.id);
    assert.equal(again.replaced, true);
    assert.equal(stored(sipho), 1);
    const listed = list(sipho);
    assert.equal(listed.templates.length, 1);
    assert.equal(listed.templates[0].name, "USED BAKKIE");
    assert.equal(listed.templates[0].kind, "listing");
    assert.deepEqual(listed.templates[0].data, { ...BAKKIE, description: "Second wording." });
    // Only the category is required; the list is ordered by name.
    save(sipho, "Another", { category: "electronics" });
    assert.deepEqual(
      list(sipho).templates.map((t) => t.name),
      ["Another", "USED BAKKIE"]
    );
    // Rename: a name used by another template is refused, its own name is not.
    fails(renameSql(sipho, first.id, "another"), "PT409", /template name already used/);
    assert.deepEqual(json(renameSql(sipho, first.id, "used bakkie")), {
      id: first.id,
      name: "used bakkie",
    });
    json(renameSql(sipho, first.id, "Dealer demo car"));
    assert.ok(list(sipho).templates.some((t) => t.name === "Dealer demo car"));
    assert.deepEqual(json(deleteSql(sipho, first.id)), { id: first.id });
    fails(deleteSql(sipho, first.id), "PT404", /template unavailable/);
    fails(renameSql(sipho, first.id, "Gone"), "PT404", /template unavailable/);
    assert.equal(stored(sipho), 1);
  });

  await check(
    "only the plan's fields: never photos, title, price, year, mileage or numbers",
    () => {
      const refusedData = [
        { ...BAKKIE, title: "Demo bakkie" },
        { ...BAKKIE, price: "289900" },
        { ...BAKKIE, negotiable: true },
        { ...BAKKIE, photos: ["media/a.jpg"] },
        { ...BAKKIE, categoryAttributes: { ...BAKKIE.categoryAttributes, year: "2019" } },
        { ...BAKKIE, categoryAttributes: { ...BAKKIE.categoryAttributes, mileage_km: "98000" } },
        { ...BAKKIE, contactMethods: ["call", "+27820000000"] },
        { ...BAKKIE, contactMethods: "call" },
        { ...BAKKIE, categoryAttributes: ["make"] },
        { ...BAKKIE, description: 5 },
        { description: "No category" },
        { ...BAKKIE, category: 3 },
        { ...BAKKIE, category: "" },
        // Prices and details of one item (the website leaves them out too).
        ...[
          "monthly_rent_zar",
          "salary_min",
          "salary_max",
          "levy_zar",
          "rates_taxes_zar",
          "number_of_owners",
          "battery_health_pct",
          "colour",
          "accident_free",
          "registration_province",
          "available_from",
          "application_deadline",
          "age_months",
          "quantity",
        ].map((key) => ({ ...BAKKIE, categoryAttributes: { make: "Toyota", [key]: "1" } })),
        // A detail is text, yes/no or a list of text.
        { ...BAKKIE, categoryAttributes: { bedrooms: 3 } },
        { ...BAKKIE, categoryAttributes: { extras: { tow_bar: true } } },
        { ...BAKKIE, categoryAttributes: { extras: ["tow_bar", 2] } },
        { ...BAKKIE, categoryAttributes: { extras: null } },
      ];
      for (const data of refusedData)
        fails(saveSql(sipho, "Refused", data), "22023", /template details invalid/);
      fails(
        member(sipho, `select api.save_my_post_template('Refused','[]'::jsonb);`),
        "22023",
        /template details invalid/
      );
      // Text, yes/no and lists of text are kept.
      const kept = save(sipho, "Detail kinds", {
        category: "property",
        categoryAttributes: { bedrooms: "3", pool: true, security_features: ["alarm", "cctv"] },
      });
      assert.equal(kept.replaced, false);
      json(deleteSql(sipho, kept.id));
      assert.equal(stored(sipho), 1);
    }
  );

  await check("the limits: 20 per account, names of 1 to 60 characters, 16 KiB", () => {
    // LIM-SQL-post-template-name (1 to 60 characters, also on rename).
    fails(saveSql(sipho, "   "), "22023", /template name 1 to 60 characters/);
    fails(saveSql(sipho, "a".repeat(61)), "22023", /template name 1 to 60 characters/);
    fails(saveSql(sipho, "Tab\tname"), "22023", /template name 1 to 60 characters/);
    const longest = save(sipho, "a".repeat(60));
    fails(renameSql(sipho, longest.id, "b".repeat(61)), "22023", /1 to 60 characters/);
    fails(renameSql(sipho, longest.id, ""), "22023", /1 to 60 characters/);
    json(renameSql(sipho, longest.id, "b"));
    // LIM-SQL-post-template-size (16 KiB of form fields).
    const sized = (bytes) => {
      const data = { category: "vehicles", description: "" };
      // jsonb prints ": " and ", " (three spaces here) where JSON.stringify has none.
      data.description = "d".repeat(bytes - JSON.stringify(data).length - 3);
      assert.equal(
        Number(q(`select octet_length(${sqlLiteral(JSON.stringify(data))}::jsonb::text);`)),
        bytes
      );
      return data;
    };
    save(sipho, "At the size limit", sized(16384));
    fails(saveSql(sipho, "Past the size limit", sized(16385)), "22023", /details invalid/);
    // LIM-SQL-post-template-count (20 per account; replacing one still works).
    while (stored(sipho) < 20)
      save(sipho, `Template ${stored(sipho)}`, { category: "electronics" });
    fails(saveSql(sipho, "The 21st"), "PT429", /up to 20 templates/);
    assert.equal(save(sipho, "Template 5", { category: "property" }).replaced, true);
    assert.equal(stored(sipho), 20);
  });

  await check("another member, a visitor and a member without a package", () => {
    const theirs = list(sipho).templates[0];
    const other = verified("tpl-other");
    assert.deepEqual(list(other), { package_running: false, templates: [] });
    fails(renameSql(other, theirs.id, "Mine now"), "PT404", /template unavailable/);
    fails(deleteSql(other, theirs.id), "PT404", /template unavailable/);
    // Saving needs a running Multi-listing package (Individual members have none).
    fails(saveSql(other, "Used bakkie"), "PT402", /Multi-listing package/);
    fails(
      `set role anon;\nselect api.delete_my_post_template('${theirs.id}');`,
      "42501",
      /permission denied/
    );
    assert.equal(stored(sipho), 20);
    // After the package ends the member still sees, renames and deletes theirs.
    q(`update private.entitlements set ends_at=now()-interval '1 minute',starts_at=now()-interval '31 days'
         where owner_id='${sipho.id}' and package_id is not null;`);
    const ended = list(sipho);
    assert.equal(ended.package_running, false);
    assert.equal(ended.templates.length, 20);
    fails(saveSql(sipho, "Template 5"), "PT402", /Multi-listing package/);
    json(renameSql(sipho, theirs.id, "Still mine"));
    json(deleteSql(sipho, theirs.id));
    assert.equal(stored(sipho), 19);
  });

  await check("the privacy export lists the templates", () => {
    const exported = json(`select internal.frontend_privacy_export_data('${sipho.id}');`);
    assert.equal(exported.post_templates.length, 19);
    const one = exported.post_templates.find((t) => t.name === "Template 5");
    assert.deepEqual(Object.keys(one).sort(), [
      "created_at",
      "data",
      "id",
      "kind",
      "name",
      "updated_at",
    ]);
    assert.deepEqual(one.data, { category: "property" });
    assert.deepEqual(
      json(`select internal.frontend_privacy_export_data('${world.user("tpl-empty").id}');`)
        .post_templates,
      []
    );
  });

  await check("templates go when the account closes, and with the Auth user", () => {
    const other = verified("tpl-closer");
    q(
      `insert into private.post_templates(owner_id,name,data) values('${other.id}','Kept','{"category":"vehicles"}');`
    );
    q(`insert into private.account_closures(user_id,evidence_delete_after)
         values('${sipho.id}',statement_timestamp()+interval '90 days');`);
    assert.equal(stored(sipho), 0);
    assert.equal(stored(other), 1, "another account's templates stay");
    const plain = world.user("tpl-auth-delete");
    q(
      `insert into private.post_templates(owner_id,name,data) values('${plain.id}','Gone','{"category":"vehicles"}');`
    );
    q(`delete from auth.users where id='${plain.id}';`);
    assert.equal(stored(plain), 0);
  });

  await check("the preflight counts templates after the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], APPLIED);
    assert.match(rows[0][1], /templates: 1; accounts with templates: 1$/);
  });
});
