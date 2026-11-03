// @vitest-environment node
import { expect, it } from "vitest";
import { z } from "zod";
import {
  createPlaywrightSession,
  ensurePlaywrightVerifiedMember,
  listPlaywrightTableRows,
  resetPlaywrightFixtureStoreForPersona,
  resolvePlaywrightSession,
} from "./playwright-fixture-store";

it("keeps secure fixture identifiers consistent through sessions and persona resets", () => {
  const persona = "kyc-member-identifier-regression";
  const member = ensurePlaywrightVerifiedMember(persona);
  const profile = listPlaywrightTableRows("account_profiles").find(
    (row) => row.user_id === member.id
  );
  const session = createPlaywrightSession(persona);
  expect(z.uuid().safeParse(member.id).success).toBe(true);
  expect(z.uuid().safeParse(profile?.id).success).toBe(true);
  expect(resolvePlaywrightSession(session.token)?.id).toBe(member.id);

  resetPlaywrightFixtureStoreForPersona(persona);
  const restored = ensurePlaywrightVerifiedMember(persona);
  const restoredProfile = listPlaywrightTableRows("account_profiles").find(
    (row) => row.user_id === restored.id
  );
  expect(restored.id).toBe(member.id);
  expect(restoredProfile?.id).toBe(profile?.id);
  expect(createPlaywrightSession(persona).user.id).toBe(member.id);
  expect(ensurePlaywrightVerifiedMember("kyc-member-another-identifier").id).not.toBe(member.id);
});
