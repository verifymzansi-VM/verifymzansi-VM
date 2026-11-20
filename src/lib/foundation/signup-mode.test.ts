/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { readFoundationSignupMode } from "./signup-mode";
import { foundationRegistrationReply } from "./registration-message";

const project = "gntzjtuncsyefujajmjy";
const connection = {
  url: `https://${project}.supabase.co`,
  expectedProjectRef: project,
  publishableKey: "sb_publishable_synthetic",
};

describe("readFoundationSignupMode", () => {
  it("reads the mode through the public command api.get_signup_mode", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ mode: "open" }));
    await expect(readFoundationSignupMode(connection, fetcher)).resolves.toBe("open");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(`https://${project}.supabase.co/rest/v1/rpc/get_signup_mode`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-profile")).toBe("api");
  });

  it("answers null, never throwing, when the mode cannot be read", async () => {
    for (const reply of [
      () => Response.json({ mode: "public" }),
      () => Response.json({ mode: "open", extra: true }),
      () => Response.json({ code: "PGRST202", message: "missing" }, { status: 404 }),
      () => {
        throw new TypeError("network down");
      },
    ]) {
      const fetcher = vi.fn<typeof fetch>(async () => reply());
      await expect(readFoundationSignupMode(connection, fetcher)).resolves.toBeNull();
    }
    await expect(readFoundationSignupMode({ url: "not a connection" })).resolves.toBeNull();
  });
});

describe("foundationRegistrationReply", () => {
  it("follows the database's mode and falls back to the environment switch", () => {
    vi.stubEnv("FOUNDATION_REGISTRATION_INVITE_ONLY", "true");
    expect(foundationRegistrationReply("open").inviteOnly).toBe(false);
    expect(foundationRegistrationReply(null).inviteOnly).toBe(true);
    vi.stubEnv("FOUNDATION_REGISTRATION_INVITE_ONLY", "false");
    expect(foundationRegistrationReply("invite_only").inviteOnly).toBe(true);
    expect(foundationRegistrationReply().inviteOnly).toBe(false);
    vi.unstubAllEnvs();
  });
});
