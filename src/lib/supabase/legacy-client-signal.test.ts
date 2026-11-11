/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SignalModuleType from "./legacy-client-signal";

const mocks = vi.hoisted(() => ({
  getStore: vi.fn<() => { route?: unknown } | undefined>(() => undefined),
  createSupabaseClient: vi.fn(() => ({ marker: "legacy-client" })),
}));
vi.mock("next/dist/server/app-render/work-async-storage.external", () => ({
  workAsyncStorage: { getStore: mocks.getStore },
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createSupabaseClient }));
vi.mock("@/lib/supabase/playwright-mode", () => ({ isPlaywrightSupabaseStubMode: () => false }));

type SignalModule = typeof SignalModuleType;

let warn: ReturnType<typeof vi.spyOn>;

async function freshSignal(): Promise<SignalModule> {
  vi.resetModules();
  return import("./legacy-client-signal");
}

function entries() {
  return warn.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])));
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.getStore.mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.getStore.mockReset();
  mocks.createSupabaseClient.mockClear();
});

describe("legacy_client_in_foundation log line", () => {
  it("writes one structured entry with the route pattern and client kind only", async () => {
    mocks.getStore.mockReturnValue({ route: "/api/organisations/[id]/report" });
    const { noteLegacyClientCreated } = await freshSignal();

    noteLegacyClientCreated("admin");

    expect(entries()).toEqual([
      {
        timestamp: expect.any(String),
        level: "warn",
        context: "LegacyBackend",
        message: "legacy_client_in_foundation",
        meta: { route: "/api/organisations/[id]/report", client: "admin" },
      },
    ]);
  });

  it("logs each route once per window, then again after it", async () => {
    vi.useFakeTimers();
    mocks.getStore.mockReturnValue({ route: "/api/contact" });
    const { noteLegacyClientCreated } = await freshSignal();

    noteLegacyClientCreated("server");
    noteLegacyClientCreated("admin");
    noteLegacyClientCreated("admin");
    expect(warn).toHaveBeenCalledTimes(1);

    mocks.getStore.mockReturnValue({ route: "/api/engagement/like" });
    noteLegacyClientCreated("admin");
    expect(warn).toHaveBeenCalledTimes(2);

    mocks.getStore.mockReturnValue({ route: "/api/contact" });
    vi.advanceTimersByTime(9 * 60 * 1000);
    noteLegacyClientCreated("admin");
    expect(warn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60 * 1000);
    noteLegacyClientCreated("admin");
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("keeps its memory bounded when many routes run", async () => {
    vi.useFakeTimers();
    const { noteLegacyClientCreated } = await freshSignal();
    for (let index = 0; index < 250; index += 1) {
      mocks.getStore.mockReturnValue({ route: `/api/route-${index}` });
      noteLegacyClientCreated("admin");
    }
    expect(warn).toHaveBeenCalledTimes(250);
    // The oldest routes were forgotten (bounded), the newest are still deduplicated.
    mocks.getStore.mockReturnValue({ route: "/api/route-0" });
    noteLegacyClientCreated("admin");
    mocks.getStore.mockReturnValue({ route: "/api/route-249" });
    noteLegacyClientCreated("admin");
    expect(warn).toHaveBeenCalledTimes(251);
  });

  it.each([
    ["no request scope", undefined],
    ["no route", {}],
    ["a query string", { route: "/api/contact?email=person@example.test" }],
    ["an encoded value", { route: "/api/x/%40person" }],
    ["a full URL", { route: "https://verifymzansi.co.za/api/contact" }],
    ["a non-string route", { route: 42 }],
    ["an overlong route", { route: `/${"a".repeat(200)}` }],
  ])("reports route 'unknown' for %s", async (_label, store) => {
    mocks.getStore.mockReturnValue(store as { route?: unknown } | undefined);
    const { noteLegacyClientCreated } = await freshSignal();

    noteLegacyClientCreated("public");

    expect(entries()).toEqual([
      expect.objectContaining({ meta: { route: "unknown", client: "public" } }),
    ]);
  });

  it("never throws, whatever fails underneath", async () => {
    const { noteLegacyClientCreated } = await freshSignal();
    mocks.getStore.mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => noteLegacyClientCreated("admin")).not.toThrow();

    mocks.getStore.mockReturnValue({ route: "/api/contact" });
    warn.mockImplementation(() => {
      throw new Error("console unavailable");
    });
    expect(() => noteLegacyClientCreated("admin")).not.toThrow();
  });
});

describe("retired client factories", () => {
  it("createAdminClient logs once and otherwise behaves exactly as before", async () => {
    mocks.getStore.mockReturnValue({ route: "/api/engagement/like" });
    vi.resetModules();
    const { createAdminClient } = await import("./admin");

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(() => createAdminClient()).toThrow("Missing Supabase admin credentials");

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-fixture");
    expect(createAdminClient()).toEqual({ marker: "legacy-client" });

    expect(entries()).toEqual([
      expect.objectContaining({
        message: "legacy_client_in_foundation",
        meta: { route: "/api/engagement/like", client: "admin" },
      }),
    ]);
  });

  it("createPublicClient logs once per route", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-fixture");
    mocks.getStore.mockReturnValue({ route: "/listing/[id]" });
    vi.resetModules();
    const { createPublicClient } = await import("./server");

    expect(createPublicClient()).toEqual({ marker: "legacy-client" });
    expect(entries()).toEqual([
      expect.objectContaining({ meta: { route: "/listing/[id]", client: "public" } }),
    ]);

    createPublicClient();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
