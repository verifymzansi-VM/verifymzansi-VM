import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getPublicRuntimeConfig } from "../public-runtime-config";
import { createBrowserClient } from "@supabase/ssr";

vi.mock("../public-runtime-config", () => ({ getPublicRuntimeConfig: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: vi.fn() }));
const base = {
  appUrl: "https://verifymzansi.com",
  supabaseUrl: "https://gntzjtuncsyefujajmjy.supabase.co",
  supabaseAnonKey: "sb_publishable_browser_synthetic",
  turnstileSiteKey: "",
  cfImageResizing: false,
  officialSocialLinks: {},
};
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(getPublicRuntimeConfig).mockReturnValue(base);
  vi.mocked(createBrowserClient).mockImplementation(
    () =>
      ({ auth: { stopAutoRefresh: vi.fn() } }) as unknown as ReturnType<typeof createBrowserClient>
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("creates a project-specific api client without borrowing the SSR package's legacy singleton", async () => {
  const { getFoundationBrowserClient } = await import("./browser-client");
  const first = getFoundationBrowserClient();
  expect(getFoundationBrowserClient()).toBe(first);
  expect(createBrowserClient).toHaveBeenCalledTimes(1);
  expect(createBrowserClient).toHaveBeenCalledWith(
    base.supabaseUrl,
    base.supabaseAnonKey,
    expect.objectContaining({
      isSingleton: false,
      db: { schema: "api", retry: false },
      cookieOptions: { secure: true },
      auth: { detectSessionInUrl: false, experimental: { appendPkceFlowIdToRedirects: true } },
    })
  );
});
it.each([
  { supabaseUrl: "https://tnygdgormnofpgjknlhr.supabase.co" },
  { supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co" },
  { supabaseAnonKey: "sb_secret_forbidden_synthetic" },
])(
  "refuses incorrect projects or private keys even after a valid client was cached %#",
  async (change) => {
    const { getFoundationBrowserClient } = await import("./browser-client");
    getFoundationBrowserClient();
    vi.mocked(getPublicRuntimeConfig).mockReturnValue({ ...base, ...change });
    expect(() => getFoundationBrowserClient()).toThrow();
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
  }
);
it("retires auto-refresh on key rotation instead of keeping a stale cached client", async () => {
  const { getFoundationBrowserClient } = await import("./browser-client");
  const first = getFoundationBrowserClient();
  vi.mocked(getPublicRuntimeConfig).mockReturnValue({
    ...base,
    supabaseAnonKey: "sb_publishable_browser_rotated_synthetic",
  });
  expect(getFoundationBrowserClient()).not.toBe(first);
  expect(first.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
});
it("does not share Auth state between server renders", async () => {
  vi.stubGlobal("window", undefined);
  const { getFoundationBrowserClient } = await import("./browser-client");
  expect(getFoundationBrowserClient()).not.toBe(getFoundationBrowserClient());
  expect(createBrowserClient).toHaveBeenCalledTimes(2);
});
it("rejects a local Auth endpoint in a production-hosted app", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.mocked(getPublicRuntimeConfig).mockReturnValue({
    ...base,
    supabaseUrl: "http://127.0.0.1:55443",
  });
  const { getFoundationBrowserClient } = await import("./browser-client");
  expect(() => getFoundationBrowserClient()).toThrow("isolated local app");
  expect(createBrowserClient).not.toHaveBeenCalled();
});
