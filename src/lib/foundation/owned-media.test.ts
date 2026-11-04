/** @vitest-environment node */
import { it, expect, vi } from "vitest";
import { resolveOwnedMedia } from "./owned-media";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
const id = "11111111-1111-4111-8111-111111111111",
  key = "media/22222222-2222-4222-8222-222222222222";
it("binds a public key to its independent canonical object ID through the caller's RPC", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: [{ object_id: id, object_key: key, kind: "image", state: "ready" }],
    error: null,
  });
  const value = await resolveOwnedMedia({ rpc } as unknown as FoundationAuthenticatedApi, {
    keys: [key, key],
  });
  expect(value[0].object_id).toBe(id);
  expect(rpc).toHaveBeenCalledWith("resolve_my_frontend_media", { p_keys: [key] }, { get: false });
});
it("refuses omitted or unrequested references and unavailable media without assigning authority from a URL", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  await expect(
    resolveOwnedMedia({ rpc } as unknown as FoundationAuthenticatedApi, { keys: [key] })
  ).rejects.toThrow("resolution changed");
  rpc.mockResolvedValue({ data: null, error: { code: "22023" } });
  await expect(
    resolveOwnedMedia({ rpc } as unknown as FoundationAuthenticatedApi, { ids: [id] })
  ).rejects.toMatchObject({ status: 422 });
});
