import assert from "node:assert/strict";

export const UNRELEASED_BASELINE_GUARD = `-- CLI-created BF-09 draft. Deliberately cannot deploy while acceptance is open.
-- candidate.sql is a separately reviewed assembly, not a migration to run here.
do $foundation_gate$
begin
  raise exception 'Unreleased foundation draft: G1 and BF-09 gates are incomplete';
end;
$foundation_gate$;
`;

export function assertUnreleasedBaselineGuard(sql) {
  assert.equal(
    sql.replaceAll("\r\n", "\n"),
    UNRELEASED_BASELINE_GUARD,
    "Unreleased migration must exactly match the reviewed guard; comments/conditional bypasses are prohibited"
  );
}
