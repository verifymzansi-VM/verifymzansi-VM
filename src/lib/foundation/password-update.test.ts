/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import {
  createFoundationPasswordUpdater,
  createFoundationPasswordResetter,
} from "./password-update";
import { foundationPasswordUpdateSchema } from "./password-update-input";
vi.mock("server-only", () => ({}));
const config = {
  url: "https://gntzjtuncsyefujajmjy.supabase.co",
  expectedProjectRef: "gntzjtuncsyefujajmjy",
  publishableKey: "sb_publishable_synthetic",
};
const id = "00000000-0000-4000-8000-000000000001";

it("recovery omits the old password and revokes sessions only after one verified update", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const result = await createFoundationPasswordResetter(
    config,
    "verified-recovery-token",
    id,
    Math.floor(Date.now() / 1000),
    fetcher
  )("synthetic-next-password");
  expect(result).toEqual({ signOutComplete: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    password: "synthetic-next-password",
  });
  expect(String(fetcher.mock.calls[1][0])).toBe(config.url + "/auth/v1/logout?scope=global");
  expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("authorization")).toBe(
    "Bearer verified-recovery-token"
  );
});
it("expired recovery cannot send a password update", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    createFoundationPasswordResetter(
      config,
      "token",
      id,
      Math.floor(Date.now() / 1000) - 3601,
      fetcher
    )("synthetic-next-password")
  ).rejects.toMatchObject({ status: 401 });
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps a committed reset distinct from an unavailable sign-out", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id }))
    .mockRejectedValueOnce(new Error("network unavailable"));
  await expect(
    createFoundationPasswordResetter(
      config,
      "token",
      id,
      Math.floor(Date.now() / 1000),
      fetcher
    )("synthetic-next-password")
  ).resolves.toEqual({ signOutComplete: false });
  expect(fetcher.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1);
});
it("sends only current/new passwords to the fixed target and verified caller token once", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id }));
  await createFoundationPasswordUpdater(
    config,
    "synthetic-verified-token",
    id,
    fetcher
  )("synthetic-current", "synthetic-next-password");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(config.url + "/auth/v1/user");
  expect(init).toMatchObject({
    method: "PUT",
    cache: "no-store",
    redirect: "error",
    credentials: "omit",
  });
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-verified-token");
  expect(JSON.parse(String(init?.body))).toEqual({
    password: "synthetic-next-password",
    current_password: "synthetic-current",
  });
});
it.each([
  ["current_password_invalid", 400, "current_password"],
  ["current_password_required", 400, "current_password"],
  ["insufficient_aal", 403, "mfa_required"],
  ["reauthentication_needed", 401, "reauthentication"],
  ["weak_password", 400, "password_policy"],
  ["same_password", 400, "password_policy"],
] as const)("keeps %s closed without retry", async (code, status, reason) => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ error_code: code }, { status: 400 })
  );
  await expect(
    createFoundationPasswordUpdater(
      config,
      "synthetic-token",
      id,
      fetcher
    )("current", "synthetic-next-password")
  ).rejects.toMatchObject({ status, reason });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not acknowledge a mismatched provider user", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "another-user" }));
  await expect(
    createFoundationPasswordUpdater(
      config,
      "synthetic-token",
      id,
      fetcher
    )("current", "synthetic-next-password")
  ).rejects.toMatchObject({ status: 503 });
});
it("accepts the provider's explicit user response envelope", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ user: { id } }));
  await expect(
    createFoundationPasswordUpdater(
      config,
      "synthetic-token",
      id,
      fetcher
    )("current", "synthetic-next-password")
  ).resolves.toBeUndefined();
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("x-supabase-api-version")).toBe(
    "2024-01-01"
  );
});
it("does not retry an ambiguous network failure", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("network failure");
  });
  await expect(
    createFoundationPasswordUpdater(
      config,
      "synthetic-token",
      id,
      fetcher
    )("current", "synthetic-next-password")
  ).rejects.toMatchObject({ status: 503 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects actor selectors, short or identical passwords, and confirmation mismatches", () => {
  const valid = {
    currentPassword: "synthetic-current",
    newPassword: "synthetic-next-password",
    confirmNewPassword: "synthetic-next-password",
  };
  expect(foundationPasswordUpdateSchema.safeParse(valid).success).toBe(true);
  for (const value of [
    { ...valid, owner_id: id },
    { ...valid, newPassword: "short", confirmNewPassword: "short" },
    { ...valid, confirmNewPassword: "different" },
    { ...valid, newPassword: valid.currentPassword, confirmNewPassword: valid.currentPassword },
  ])
    expect(foundationPasswordUpdateSchema.safeParse(value).success).toBe(false);
});
