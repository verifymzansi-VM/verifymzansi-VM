import { afterEach, expect, it, vi } from "vitest";
import { hasFoundationBrowserSession } from "./browser-session-cookie";
import { getPublicRuntimeConfig } from "../public-runtime-config";
vi.mock("../public-runtime-config", () => ({ getPublicRuntimeConfig: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it.each([
  ["sb-tnygdgormnofpgjknlhr-auth-token=old", false],
  ["sb-gntzjtuncsyefujajmjy-auth-token-code-verifier=verification", false],
  ["sb-gntzjtuncsyefujajmjy-auth-token=own", true],
  ["sb-gntzjtuncsyefujajmjy-auth-token.0=own", true],
  ["sb-gntzjtuncsyefujajmjy-auth-token.bad=unrelated", false],
])("counts only the selected project's session cookies: %s", (cookie, expected) => {
  vi.mocked(getPublicRuntimeConfig).mockReturnValue({
    supabaseUrl: "https://gntzjtuncsyefujajmjy.supabase.co",
  } as ReturnType<typeof getPublicRuntimeConfig>);
  vi.stubGlobal("document", { cookie });
  expect(hasFoundationBrowserSession()).toBe(expected);
});
