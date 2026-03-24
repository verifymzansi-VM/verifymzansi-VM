import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveKey, loadMessages, defaultLocale, localeLabels, locales } from "./index";

describe("i18n", () => {
  it("exports supported locales", () => {
    expect(locales).toContain("en");
    expect(locales).toContain("zu");
    expect(locales).toContain("af");
  });

  it("exports locale labels", () => {
    expect(localeLabels.en).toBe("English");
    expect(localeLabels.zu).toBe("isiZulu");
  });

  it("defaultLocale is en", () => {
    expect(defaultLocale).toBe("en");
  });

  describe("resolveKey", () => {
    const messages = {
      common: { signIn: "Sign In", greeting: "Hello {name}" },
    } as never;

    it("resolves nested key", () => {
      expect(resolveKey(messages, "common.signIn")).toBe("Sign In");
    });

    it("returns key for missing path", () => {
      expect(resolveKey(messages, "missing.key")).toBe("missing.key");
    });

    it("interpolates params", () => {
      expect(resolveKey(messages, "common.greeting", { name: "World" })).toBe("Hello World");
    });

    it("keeps placeholder when param missing", () => {
      expect(resolveKey(messages, "common.greeting", {})).toBe("Hello {name}");
    });

    it("returns key when value is not a string", () => {
      expect(resolveKey(messages, "common")).toBe("common");
    });
  });

  describe("loadMessages", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("loads and caches en messages", async () => {
      const msgs = await loadMessages("en");
      expect(msgs).toBeDefined();
      expect(typeof msgs).toBe("object");
      // Second call should be cached
      const cached = await loadMessages("en");
      expect(cached).toBe(msgs);
    });
  });
});
