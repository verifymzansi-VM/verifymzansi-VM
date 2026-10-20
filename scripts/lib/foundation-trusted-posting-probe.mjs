import assert from "node:assert/strict";
import {
  createPostingVerifier,
  createTrustedPostingFixture,
} from "./foundation-trusted-posting-fixture.mjs";
import { captureFoundationFinancialState } from "./foundation-financial-snapshot.mjs";

/** Positive canonical-flow extraction check only; physical providers are synthetic.
 * This does not yet attest the draft publication-readiness guard. */
export async function testTrustedPostingFixture({
  createUser,
  fixtureAdminId,
  rpc,
  sql,
  stage,
  record,
}) {
  stage("genuine posting fixture independent reviewer and fresh owner");
  const reviewer = await createPostingVerifier({ createUser, sql, fixtureAdminId }),
    owner = await createUser("trusted-posting-owner");
  const fixture = createTrustedPostingFixture({ rpc, sql, reviewer });
  const ready = () =>
    sql("select internal.current_verified_identity('" + owner.id + "') is not null;");
  const financialBefore = captureFoundationFinancialState(sql);
  assert.equal(ready(), "f");
  await fixture.identity(owner);
  assert.equal(ready(), "f", "Accepted identity alone does not prove complete readiness");
  await fixture.phone(owner);
  assert.equal(ready(), "f", "Phone and identity still need canonical locality");
  await fixture.locality(owner);
  assert.equal(ready(), "t");
  assert.equal(captureFoundationFinancialState(sql), financialBefore);
  record(
    "native-trusted-posting-fixture-genuine-identity-phone-locality-no-trial-or-financial-effect"
  );
}
