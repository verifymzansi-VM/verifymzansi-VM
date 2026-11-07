import { openFixture, readStatus, verifySchema } from "../../scripts/lib/foundation-e2e-stack.mjs";
import { assertLocalFoundationTarget } from "../../scripts/lib/foundation-e2e-target.mjs";
import { readTestCopy } from "./support/test-copy";

/**
 * Runs after the web server started the copy and before any spec: the stack
 * must be the local throwaway one (loopback only, never a hosted project), the
 * schema must be exactly the database/foundation replay with zero tables in
 * public, and the seeded state must belong to this stack.
 */
export default async function globalSetup() {
  const fixture = openFixture();
  const status = readStatus(fixture);
  assertLocalFoundationTarget({ apiUrl: status.apiUrl, dbUrl: status.dbUrl });
  const schema = verifySchema(fixture);
  if (schema.publicTables !== 0) throw new Error("The test copy must have no tables in public");
  const state = readTestCopy();
  if (state.apiUrl !== status.apiUrl) throw new Error("Seeded state belongs to another stack");
}
