import { expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { readFoundationAccountContext } from "./account-context";

const account = {
  version: 1,
  account_id: "00000000-0000-4000-8000-000000000001",
  email: "member@example.invalid",
  phone: null,
  totp_enrolled: false,
  staff: null,
  profile: {
    display_name: "Thando M.",
    public_name: "Thando M.",
    bio: null,
    avatar_object_id: null,
    legal_first_name: null,
    legal_last_name: null,
    legal_name_locked: false,
    identity_verified: false,
    revision: 1,
    updated_at: "2026-10-24T08:00:00.123456+00:00",
  },
};
const client = (rpc: unknown) => ({ rpc }) as FoundationAuthenticatedApi;
it("reads only the verified caller's context once and preserves profile precision", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: account, error: null });
  expect(await readFoundationAccountContext(client(rpc))).toEqual(account);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_account_context", {}, { get: false });
});
it.each([
  { version: 2 },
  { role: "admin" },
  { phone: "unverified value" },
  { staff: { role: "unknown", can_access: false, assigned_capabilities: [] } },
  { staff: { role: "admin", can_access: true, assigned_capabilities: ["queue:view"] } },
  {
    staff: {
      role: "admin",
      can_access: false,
      assigned_capabilities: Array(129).fill("queue:view"),
    },
  },
])("rejects invalid context or contradictory authority hints %#", async (change) => {
  await expect(
    readFoundationAccountContext(
      client(vi.fn().mockResolvedValue({ data: { ...account, ...change }, error: null }))
    )
  ).rejects.toMatchObject({ reason: "unavailable" });
});
it.each([
  ["42501", "forbidden"],
  ["XX000", "unavailable"],
])("sanitizes database refusal %s without retries", async (code, reason) => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: null, error: { code, message: "PRIVATE_DATABASE_DETAIL" } });
  await expect(readFoundationAccountContext(client(rpc))).rejects.toMatchObject({
    reason,
    message: "Current account details are unavailable",
  });
  expect(rpc).toHaveBeenCalledTimes(1);
});
