import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
