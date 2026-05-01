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
});
