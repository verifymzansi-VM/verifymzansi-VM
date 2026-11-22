// Behaviour checks for 20261122013616_authority_request_types.sql (rule D9),
// run by scripts/test-foundation-identity-record-disclosure.mjs after the
// authority request update and the updates between them, with its people and
// helpers. A record opens only for a subpoena, a court order, a search warrant
// or an urgent written SAPS request where a life is at risk; each needs its
// reference, who issued it, the official number that was called and who
// confirmed it; an urgent request never gives the selfie (or the ID photo).
// Earlier records stay readable as they were.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyWithRollbackCheck,
  assertDriftRefused,
  assertReadOnlyPreflight,
  executeGrants,
  sqlLiteral,
  updateCheckViews,
} from "./foundation-sql-checks.mjs";

export const D9_UPDATE = "20261122013616_authority_request_types.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${D9_UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const OPEN_D9 = "api.open_authority_request(text,text,text,text,text,text,text,text,boolean)";
const REPLACED = [
  "internal.open_identity_disclosure(text,text,text,text,text,boolean)",
  "internal.read_identity_disclosure(uuid,text,uuid)",
  "internal.identity_disclosure_record(private.identity_disclosures,uuid)",
  "internal.identity_disclosure_material(uuid,uuid)",
];
/** Texts with no letter or digit: zero-width, direction marks, combining
 * marks, line breaks and tabs, no-break and ideographic spaces. */
const INVISIBLE = [
  [0x200b, 0x200b, 0x200b],
  [0x200e, 0x200f, 0x200e],
  [0x301, 0x301, 0x301],
  [0x0a, 0x09, 0x0a],
  [0xa0, 0xa0, 0xa0],
  [0x3000, 0x3000, 0x3000],
  [0x2e, 0x2d, 0x2e],
].map((points) => String.fromCodePoint(...points));
const D9_TYPES = ["subpoena", "court_order", "search_warrant", "urgent_life_risk"];

/** A D9 request: subpoena by default, every part present. */
export const d9Request = (overrides = {}) => ({
  type: "subpoena",
  reference: "CAS 123/11/2026",
  issuedBy: "Richards Bay Magistrate's Court",
  number: "035 789 1234",
  confirmedBy: "Ms T. Zulu, clerk of the court",
  reason: "Fraud investigation into a reported listing; the subpoena names the account holder.",
  kind: "phone",
  value: "+27820000000",
  attested: true,
  ...overrides,
});
const value = (v) => (v === null ? "null" : sqlLiteral(v));
export const d9OpenSql = (r) =>
  `select api.open_authority_request(${[
    r.type,
    r.reference,
    r.issuedBy,
    r.number,
    r.confirmedBy,
    r.reason,
    r.kind,
    r.value,
  ]
    .map(value)
    .join(",")},${r.attested === null ? "null" : r.attested});`;

/**
 * `ctx`: the suite's psql helpers, people and helpers; `database` and
 * `current` for the update's own preflight; `step` is the update's replay
 * step; `earlier` are records opened before the update ({ id, type }).
 */
export async function checkAuthorityRequestTypes(ctx, { database, current, step, earlier }) {
  const { check, q, json, fails, staff, service, fingerprint, admin, governor, moderator } = ctx;
  const { thando, logCount, eventCount, openSql, request, readSql, read } = ctx;
  const { preflightRows: preflight } = updateCheckViews(database, current, {
    preflight: PREFLIGHT,
  });
  const open = (r, who = admin) => json(staff(who, d9OpenSql(r)));
  const urgentRequest = d9Request({
    type: "urgent_life_risk",
    reference: "CAS 77/11/2026",
    issuedBy: "Richards Bay SAPS",
    number: "035 901 7000",
    confirmedBy: "W/O N. Mthembu, duty officer",
    value: thando.phones.at(-1),
  });

  await check("D9 preflight before the update: read only, summary only", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], /^authority request types: update not applied; disclosures: \d+$/);
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("D9: drift and a premature rollback are refused", () =>
    assertDriftRefused(
      { q, fails, fingerprint, preflightRows: preflight },
      {
        rollback: ROLLBACK,
        updateSql: step.sql,
        signatures: REPLACED,
        drift: /authority request types drift/,
      }
    )
  );
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "authority request types",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^authority request types: already applied; disclosures: \d+; under rule D9: 0; urgent: 0$/,
  });

  await check("D9 grants: the new command for authenticated only, never security definer", () => {
    assert.deepEqual(executeGrants(json, [OPEN_D9]), {
      [OPEN_D9]: { anon: false, authenticated: true, service_role: false },
    });
    assert.equal(
      q(
        `select prosecdef::text||':'||array_to_string(proconfig,',') from pg_proc where oid='${OPEN_D9}'::regprocedure;`
      ),
      "false:search_path=pg_catalog"
    );
    fails(`set role anon;\n${d9OpenSql(d9Request())}`, "42501", /permission denied for function/);
    fails(service(d9OpenSql(d9Request())), "42501", /permission denied for function/);
    fails(staff(moderator, d9OpenSql(d9Request())), "42501", /capability not granted/);
  });

  await check("D9: records opened before the update read as they did", () => {
    for (const { id, type } of earlier) {
      const shown = read(admin, id);
      assert.equal(shown.disclosure.request_type, type);
      for (const key of ["issued_by", "confirmed_number", "confirmed_by"])
        assert.ok(!(key in shown.disclosure), `${key} on an earlier record`);
      if (shown.records[0]?.kept) assert.ok(shown.records[0].selfie, "selfie state kept");
    }
    const listed = json(staff(governor, `select api.list_identity_disclosures();`)).items;
    for (const { id, type } of earlier)
      assert.equal(listed.find((item) => item.id === id)?.request_type, type);
  });

  await check("D9: the earlier command is always refused, and logs nothing", () => {
    const before = logCount();
    for (const type of ["warrant", "police_case", "regulator"])
      assert.match(
        fails(staff(admin, openSql(request({ type }))), "22023"),
        /DETAIL:\s+disclosure_request_type_invalid/
      );
    for (const type of D9_TYPES)
      assert.match(
        fails(staff(admin, openSql(request({ type }))), "22023"),
        /DETAIL:\s+disclosure_issued_by_required/
      );
    assert.equal(logCount(), before);
  });

  await check(
    "D9: only a subpoena, court order, search warrant or urgent life-risk request",
    () => {
      const before = logCount();
      for (const type of ["warrant", "police_case", "regulator", "letter", "", null])
        assert.match(
          fails(staff(admin, d9OpenSql(d9Request({ type }))), "22023"),
          /DETAIL:\s+disclosure_request_type_invalid/
        );
      assert.equal(logCount(), before);
    }
  );

  await check("D9: each type needs its reference, issuer, number called and who confirmed", () => {
    const before = logCount();
    const refused = [
      [{ reference: "  " }, "disclosure_reference_required"],
      [{ reference: null }, "disclosure_reference_required"],
      [{ issuedBy: null }, "disclosure_issued_by_required"],
      [{ issuedBy: "x" }, "disclosure_issued_by_required"],
      [{ issuedBy: "x".repeat(121) }, "disclosure_issued_by_required"],
      [{ number: null }, "disclosure_confirmed_number_required"],
      [{ number: "1234" }, "disclosure_confirmed_number_required"],
      [{ number: "called the court" }, "disclosure_confirmed_number_required"],
      [{ number: "035 789 1234 ext 5" }, "disclosure_confirmed_number_required"],
      [{ number: "0".repeat(21) }, "disclosure_confirmed_number_required"],
      // Digits are counted, not characters: single spaces only.
      [{ number: "1   1" }, "disclosure_confirmed_number_required"],
      [{ number: "035  789 1234" }, "disclosure_confirmed_number_required"],
      [{ number: "1 2 3 4" }, "disclosure_confirmed_number_required"],
      [{ number: `+${"1 ".repeat(20)}1` }, "disclosure_confirmed_number_required"],
      [{ confirmedBy: null }, "disclosure_confirmed_by_required"],
      [{ confirmedBy: "  " }, "disclosure_confirmed_by_required"],
      [{ confirmedBy: "x".repeat(121) }, "disclosure_confirmed_by_required"],
      [{ reason: "short" }, "disclosure_reason_required"],
      [{ attested: false }, "disclosure_attestation_required"],
    ];
    for (const text of INVISIBLE)
      refused.push(
        [{ reference: text }, "disclosure_reference_required"],
        [{ issuedBy: text }, "disclosure_issued_by_required"],
        [{ confirmedBy: text }, "disclosure_confirmed_by_required"]
      );
    for (const type of D9_TYPES)
      for (const [change, reason] of refused) {
        const stderr = fails(staff(admin, d9OpenSql(d9Request({ type, ...change }))), "22023");
        assert.match(stderr, new RegExp(`DETAIL:\\s+${reason}`), `${type} ${reason}: ${stderr}`);
      }
    assert.equal(logCount(), before, "nothing is logged for an incomplete request");
  });

  await check("D9: 5 to 20 digits and any script's letters are accepted", () => {
    const accented = `Ho${String.fromCodePoint(0xeb)}r Hof`;
    for (const number of ["10111", `+${"1 ".repeat(19)}1`])
      assert.equal(
        open(d9Request({ number, issuedBy: accented, value: thando.phones.at(-1) })).outcome,
        "record"
      );
  });

  await check("D9: each type opens with its reference, kept on the log row and the record", () => {
    for (const type of D9_TYPES) {
      const opened = open(
        d9Request({
          type,
          reference: ` REF-${type} `,
          issuedBy: " Durban High Court ",
          number: " +27 31 123 4567 ",
          value: thando.phones.at(-1),
        })
      );
      assert.equal(opened.outcome, "record");
      const row = json(
        `select to_jsonb(d) from private.identity_disclosures d where d.id='${opened.disclosure_id}';`
      );
      assert.deepEqual(
        [
          row.request_type,
          row.request_reference,
          row.issued_by,
          row.confirmed_number,
          row.confirmed_by,
        ],
        [
          type,
          `REF-${type}`,
          "Durban High Court",
          "+27 31 123 4567",
          "Ms T. Zulu, clerk of the court",
        ]
      );
      const shown = read(admin, opened.disclosure_id);
      assert.equal(shown.disclosure.request_type, type);
      assert.equal(shown.disclosure.reference, `REF-${type}`);
      assert.equal(shown.disclosure.issued_by, "Durban High Court");
      assert.equal(shown.disclosure.confirmed_number, "+27 31 123 4567");
      assert.equal(shown.disclosure.confirmed_by, "Ms T. Zulu, clerk of the court");
    }
    const { items } = json(staff(governor, `select api.list_identity_disclosures();`));
    for (const type of D9_TYPES)
      assert.ok(
        items.some((item) => item.request_type === type),
        type
      );
  });

  await check(
    "D9: the table refuses a new-type row without its confirmation, even from the owner",
    () => {
      const insert = (type, confirmation) =>
        `insert into private.identity_disclosures(opened_by,opened_at,closes_at,request_type,request_reference,
        ${confirmation ? "issued_by,confirmed_number,confirmed_by," : ""}reason,attested,lookup_kind,lookup_value,outcome,subject_ids,match_count)
       values('${admin.id}',now(),now()+interval '15 minutes','${type}','REF-001',
        ${confirmation ? "'Durban High Court','031 123 4567','Ms T. Zulu'," : ""}'A synthetic reason here',true,'phone','+27820000000','no_match','{}',0);`;
      // The two new types never exist without all three. (A subpoena or court
      // order without them is an earlier row; the command refuses a new one,
      // and only the command writes the table.)
      for (const type of ["search_warrant", "urgent_life_risk"]) {
        fails(insert(type, false), "23514", /confirmation_check/);
        fails(insert(type, true).replace("'Ms T. Zulu'", "null"), "23514", /confirmation_check/);
      }
    }
  );

  await check(
    "D9: an urgent request gives names, ID number and current phones, never the selfie",
    () => {
      const opened = open(urgentRequest);
      const events = eventCount();
      const shown = read(admin, opened.disclosure_id);
      assert.equal(eventCount(), events + 1);
      const [record] = shown.records;
      assert.equal(record.account_id, thando.id);
      assert.equal(record.legal_first_name, "Thando Sipho");
      assert.equal(record.legal_last_name, "Dlamini-thando");
      assert.equal(record.id_number_kept, true);
      // Only the current verified phone: no removed number, no history.
      assert.deepEqual(
        record.phones.map((p) => [p.phone, p.revoked_at]),
        [[thando.phones.at(-1), null]]
      );
      assert.ok(!("selfie" in record) && !("id_photo" in record), JSON.stringify(record));
      const printed = read(admin, opened.disclosure_id, "print");
      assert.ok(!("selfie" in printed.records[0]) && !("id_photo" in printed.records[0]));
      // The selfie is refused before anything is logged.
      const before = eventCount();
      assert.match(
        fails(staff(admin, readSql(opened.disclosure_id, "selfie", thando.id)), "22023"),
        /DETAIL:\s+disclosure_selfie_withheld/
      );
      assert.equal(eventCount(), before);
      // The server gets the encrypted ID number, never the selfie's object.
      const material = json(
        service(`select api.identity_disclosure_material('${opened.disclosure_id}','${admin.id}');`)
      );
      assert.equal(material.records.length, 1);
      assert.ok(material.records[0].encrypted_number);
      assert.equal(material.records[0].selfie, null);
      const text = JSON.stringify([shown, printed, material]);
      assert.ok(!text.includes("evidence/") && !text.includes(thando.selfie), text);
    }
  );

  await check("D9: a subpoena, court order or warrant still shows the selfie", () => {
    const opened = open(d9Request({ type: "court_order", value: thando.phones.at(-1) }));
    const [record] = read(admin, opened.disclosure_id).records;
    assert.equal(record.selfie.kept, true);
    // Earlier numbers too (with their dates), as before rule D9.
    assert.deepEqual(
      record.phones.map((p) => p.phone),
      [...thando.phones].reverse()
    );
    assert.ok(record.id_photo);
    assert.equal(read(admin, opened.disclosure_id, "selfie", thando.id).records.length, 1);
    const material = json(
      service(`select api.identity_disclosure_material('${opened.disclosure_id}','${admin.id}');`)
    );
    assert.equal(material.records[0].selfie.artifact_id, thando.selfie);
  });

  await check("D9 preflight after: counts the D9 and urgent rows", () => {
    const [summary] = preflight();
    assert.match(summary[1], /; under rule D9: [1-9]\d*; urgent: [1-9]\d*$/);
  });
  await check("D9: a rollback is refused while a D9 record is kept", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /opened under rule D9/);
    assert.equal(fingerprint(), before);
  });
}
