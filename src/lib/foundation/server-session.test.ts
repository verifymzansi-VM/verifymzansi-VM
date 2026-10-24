/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { readFoundationRequestCaller, FoundationSessionError } from "./request-api";
import { readFoundationAccountContext, FoundationAccountContextError } from "./account-context";
import { readFoundationServerSession } from "./server-session";
import type { User } from "@supabase/supabase-js";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("./request-api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationRequestCaller: vi.fn(),
}));
vi.mock("./account-context", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationAccountContext: vi.fn(),
}));
const id = "00000000-0000-4000-8000-000000000001";
const user: User = {
  id,
  email: "member@example.invalid",
  app_metadata: { role: "admin" },
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-10-24T00:00:00Z",
};
const api = { rpc: vi.fn() } as FoundationAuthenticatedApi;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({
    getAll: () => [{ name: "sb-gntzjtuncsyefujajmjy-auth-token", value: "synthetic" }],
  } as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(readFoundationRequestCaller).mockResolvedValue({
    accountId: id,
    user,
    api,
  } as Awaited<ReturnType<typeof readFoundationRequestCaller>>);
  vi.mocked(readFoundationAccountContext).mockResolvedValue({
    account_id: id,
    staff: null,
  } as Awaited<ReturnType<typeof readFoundationAccountContext>>);
});
it("returns the verified user and canonical account without deriving a staff role from metadata", async () => {
  const session = await readFoundationServerSession();
  expect(session.user).toBe(user);
  expect(session.account.staff).toBeNull();
  expect(session.api).toBe(api);
  expect(readFoundationAccountContext).toHaveBeenCalledWith(api);
});
it("rejects another account's context", async () => {
  vi.mocked(readFoundationAccountContext).mockResolvedValue({
    account_id: "00000000-0000-4000-8000-000000000002",
  } as Awaited<ReturnType<typeof readFoundationAccountContext>>);
  await expect(readFoundationServerSession()).rejects.toMatchObject({ status: 503 });
});
it("refuses inconsistent verified user and account identities", async () => {
  vi.mocked(readFoundationRequestCaller).mockResolvedValue({
    accountId: id,
    api,
    user: { ...user, id: "00000000-0000-4000-8000-000000000002" },
  });
  await expect(readFoundationServerSession()).rejects.toMatchObject({ status: 503 });
});
it.each([
  [new FoundationSessionError(401), 401],
  [new FoundationSessionError(503), 503],
] as const)("keeps a %s session refusal closed", async (error, status) => {
  vi.mocked(readFoundationRequestCaller).mockRejectedValue(error);
  await expect(readFoundationServerSession()).rejects.toMatchObject({ status });
});
it("keeps a revoked or suspended account forbidden", async () => {
  vi.mocked(readFoundationAccountContext).mockRejectedValue(
    new FoundationAccountContextError("forbidden")
  );
  await expect(readFoundationServerSession()).rejects.toMatchObject({ status: 403 });
});
