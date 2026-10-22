import { afterEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  checkPasswordBreach,
  getPwnedPasswordCount,
  isPwnedPassword,
  PwnedPasswordCheckUnavailableError,
} from "./pwned-passwords";

describe("pwned password checks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends only the SHA-1 prefix and matches the suffix locally", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("1E4C9B93F3F0682250B6CF8331B7EE68FD8:42\r\n"),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPwnedPasswordCount("password")).resolves.toBe(42);
    await expect(isPwnedPassword("password")).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.pwnedpasswords.com/range/5BAA6",
      expect.objectContaining({
        headers: expect.objectContaining({ "Add-Padding": "true" }),
      })
    );
  });

  it("returns zero when no suffix matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue("00000000000000000000000000000000000:0\r\n"),
      })
    );

    await expect(getPwnedPasswordCount("not-the-listed-password")).resolves.toBe(0);
  });

  it("throws when the range endpoint is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      })
    );

    await expect(getPwnedPasswordCount("password")).rejects.toBeInstanceOf(
      PwnedPasswordCheckUnavailableError
    );
  });

  it.each([
    "",
    "<html>upstream error</html>",
    "1E4C9B93F3F0682250B6CF8331B7EE68FD8:not-a-count",
    "1E4C9B93F3F0682250B6CF8331B7EE68FD8:-1",
    "1E4C9B93F3F0682250B6CF8331B7EE68FD8:9007199254740992",
    "1E4C9B93F3F0682250B6CF8331B7EE68FD8:42\r\nbroken",
  ])(
    "rejects malformed successful responses rather than accepting a password: %s",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
      await expect(getPwnedPasswordCount("password")).rejects.toBeInstanceOf(
        PwnedPasswordCheckUnavailableError
      );
    }
  );

  it("preserves zero-count privacy padding and case-insensitive suffix matching", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            "00000000000000000000000000000000000:0\r\n1e4c9b93f3f0682250b6cf8331b7ee68fd8:42\r\n"
          )
        )
    );
    await expect(getPwnedPasswordCount("password")).resolves.toBe(42);
  });

  it("rejects an oversized response even when its declared length is false", async () => {
    const response = new Response("0".repeat(256 * 1024 + 1), {
      headers: { "content-length": "1" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(getPwnedPasswordCount("password")).rejects.toBeInstanceOf(
      PwnedPasswordCheckUnavailableError
    );
  });
});

describe("checkPasswordBreach", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    warn.mockClear();
  });
  const listed = () =>
    vi.fn().mockImplementation(async () => new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:42"));

  it("refuses a breached password and accepts an unlisted one", async () => {
    vi.stubGlobal("fetch", listed());
    await expect(checkPasswordBreach("password", "register")).resolves.toBe("breached");
    await expect(checkPasswordBreach("a-different-long-passphrase", "register")).resolves.toBe(
      "clear"
    );
  });

  it.each([
    ["the service is down", vi.fn().mockResolvedValue({ ok: false, status: 503 })],
    ["the network fails", vi.fn().mockRejectedValue(new TypeError("fetch failed"))],
    [
      "the request times out",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")),
    ],
    ["the reply is malformed", vi.fn().mockResolvedValue(new Response("<html>oops</html>"))],
  ])("fails open with a logged event when %s", async (_case, fetchMock) => {
    vi.stubGlobal("fetch", fetchMock);
    await expect(checkPasswordBreach("password", "change_password")).resolves.toBe("unavailable");
    expect(warn).toHaveBeenCalledWith(
      "password_breach_check_unavailable",
      expect.objectContaining({ context: "change_password", outcome: "allowed" })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/"password"|5BAA6|1E4C9B93/);
  });

  it("gives up after a short timeout", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    await checkPasswordBreach("password", "reset_password");
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["off", " OFF "])("is skipped without a request when switched %s", async (value) => {
    vi.stubEnv("PASSWORD_BREACH_CHECK", value);
    const fetchMock = listed();
    vi.stubGlobal("fetch", fetchMock);
    await expect(checkPasswordBreach("password", "register")).resolves.toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "on", ""])("stays on unless explicitly off (%s)", async (value) => {
    if (value !== undefined) vi.stubEnv("PASSWORD_BREACH_CHECK", value);
    vi.stubGlobal("fetch", listed());
    await expect(checkPasswordBreach("password", "register")).resolves.toBe("breached");
  });
});
