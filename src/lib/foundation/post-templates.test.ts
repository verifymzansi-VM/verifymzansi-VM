/** @vitest-environment node */
import { NextRequest, type NextResponse } from "next/server";
import { it, beforeEach, afterEach, expect, vi, describe } from "vitest";
import {
  handleDeletePostTemplate,
  handleListPostTemplates,
  handleRenamePostTemplate,
  handleSavePostTemplate,
} from "./post-templates";
import { createFoundationRouteContext } from "./request-route";
import { checkRateLimit } from "../utils/rate-limit";

const switches = vi.hoisted(() => ({ SHOW_POST_TEMPLATES: true }));
vi.mock("../hidden-features", () => switches);
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));

const id = "11111111-1111-4111-8111-111111111111",
  csrf = "c".repeat(64),
  rpc = vi.fn();
const data = {
  category: "vehicles",
  categoryAttributes: { make: "Toyota", model: "Hilux" },
  contactMethods: ["call", "in_app"],
};
function request(method: string, body?: unknown, valid = true) {
  return new NextRequest(`https://verifymzansi.com/api/post-templates`, {
    method,
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(valid ? { "x-csrf-token": csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  switches.SHOW_POST_TEMPLATES = true;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: async (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/post-templates", () => {
  it("lists the caller's templates", async () => {
    const list = {
      package_running: true,
      templates: [{ id, kind: "listing", name: "Used bakkie", data, updated_at: "2026-11-21" }],
    };
    rpc.mockResolvedValueOnce({ data: list, error: null });
    const response = await handleListPostTemplates(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(list);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("list_my_post_templates", {}, { get: false });
  });

  it("saves only the plan's fields", async () => {
    rpc.mockResolvedValueOnce({ data: { id, name: "Used bakkie", replaced: false }, error: null });
    const response = await handleSavePostTemplate(
      request("POST", { name: "  Used bakkie ", data })
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "save_my_post_template",
      { p_name: "Used bakkie", p_data: data },
      { get: false }
    );
    for (const refused of [
      { name: "Used bakkie", data: { ...data, title: "Demo" } },
      { name: "Used bakkie", data: { ...data, price: "100" } },
      { name: "Used bakkie", data: { ...data, categoryAttributes: { year: "2019" } } },
      { name: "Used bakkie", data: { ...data, contactMethods: ["+27820000000"] } },
      { name: "", data },
      { name: "x".repeat(61), data },
    ])
      expect((await handleSavePostTemplate(request("POST", refused))).status).toBe(422);
    expect((await handleSavePostTemplate(request("POST", { name: "A", data }, false))).status).toBe(
      403
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("explains each refusal of the database", async () => {
    const cases: Array<[string, number, string]> = [
      ["PT402", 403, "package_required"],
      ["PT429", 409, "template_limit"],
      ["22023", 422, "template_invalid"],
    ];
    for (const [code, status, reason] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error: { code } });
      const response = await handleSavePostTemplate(request("POST", { name: "A", data }));
      expect(response.status).toBe(status);
      expect((await response.json()).reason).toBe(reason);
    }
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    const taken = await handleRenamePostTemplate(request("PATCH", { name: "B" }), id);
    expect(taken.status).toBe(409);
    expect((await taken.json()).reason).toBe("template_name_taken");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } });
    expect((await handleDeletePostTemplate(request("DELETE", {}), id)).status).toBe(404);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await handleDeletePostTemplate(request("DELETE", {}), id)).status).toBe(503);
  });

  it("renames and deletes by id", async () => {
    rpc.mockResolvedValueOnce({ data: { id, name: "Dealer demo car" }, error: null });
    expect(
      (await handleRenamePostTemplate(request("PATCH", { name: "Dealer demo car" }), id)).status
    ).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith(
      "rename_my_post_template",
      { p_template: id, p_name: "Dealer demo car" },
      { get: false }
    );
    rpc.mockResolvedValueOnce({ data: { id }, error: null });
    expect((await handleDeletePostTemplate(request("DELETE", {}), id)).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith(
      "delete_my_post_template",
      { p_template: id },
      { get: false }
    );
    rpc.mockClear();
    expect((await handleDeletePostTemplate(request("DELETE", {}), "not-an-id")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is not there while the switch is off", async () => {
    switches.SHOW_POST_TEMPLATES = false;
    expect((await handleListPostTemplates(request("GET"))).status).toBe(404);
    expect((await handleSavePostTemplate(request("POST", { name: "A", data }))).status).toBe(404);
    expect((await handleRenamePostTemplate(request("PATCH", { name: "A" }), id)).status).toBe(404);
    expect((await handleDeletePostTemplate(request("DELETE", {}), id)).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
