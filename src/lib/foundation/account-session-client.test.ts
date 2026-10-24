import { expect, it, vi } from "vitest";
import { fetchFoundationAccountSession } from "./account-session-client";

it("treats an absent verified session as signed out, using private same-origin transport", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
  expect(await fetchFoundationAccountSession(fetcher)).toBeNull();
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/foundation/auth/session", {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { Accept: "application/json" },
  });
});
it.each([
  [403, "forbidden"],
  [429, "unavailable"],
  [500, "unavailable"],
])("keeps refusal %s separate from a signed-out session", async (status, reason) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ error: "PRIVATE_PROVIDER_DETAIL" }, { status: Number(status) })
    );
  await expect(fetchFoundationAccountSession(fetcher)).rejects.toMatchObject({
    reason,
    message: "Current account details are unavailable",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("refuses unvalidated account data instead of accepting caller-controlled role fields", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ role: "admin", user_metadata: { role: "admin" } }));
  await expect(fetchFoundationAccountSession(fetcher)).rejects.toMatchObject({
    reason: "unavailable",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
