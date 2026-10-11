/** @vitest-environment node */
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(() => ({})), cookies: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
vi.mock("@/lib/utils/request-context", () => ({
  getOptionalCookieStore: mocks.cookies,
  readCookieValue: vi.fn(),
}));
vi.mock("@/lib/supabase/playwright-mode", () => ({ isPlaywrightSupabaseStubMode: () => false }));
import { createPublicClient } from "./server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("public reads use only the anon key without cookies or persisted auth", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-fixture");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-fixture");
  createPublicClient();
  expect(mocks.client).toHaveBeenCalledWith("https://example.supabase.co", "public-fixture", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: expect.any(Function) },
  });
  expect(mocks.cookies).not.toHaveBeenCalled();
});

it("fails closed when the anonymous credential is missing", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  expect(createPublicClient).toThrow("Missing public Supabase credentials");
  expect(mocks.client).not.toHaveBeenCalled();
});
