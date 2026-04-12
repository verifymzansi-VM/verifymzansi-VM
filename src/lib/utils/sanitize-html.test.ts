import { describe, it, expect } from "vitest";
import { escapeHtml, sanitizeUserMessage, safeExternalHref } from "./sanitize-html";

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });

  it("escapes all dangerous chars together", () => {
    expect(escapeHtml(`<img src="x" onerror='alert(1)' />`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#x27;alert(1)&#x27; /&gt;"
    );
  });

  it("passes through safe text unchanged", () => {
    expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
  });
});

describe("sanitizeUserMessage", () => {
  it("strips HTML tags", () => {
    expect(sanitizeUserMessage("<b>bold</b>")).toBe("bold");
  });

  it("strips script tags and escapes remaining content", () => {
    expect(sanitizeUserMessage('<script>alert("xss")</script>')).toBe("alert(&quot;xss&quot;)");
  });

  it("trims whitespace", () => {
    expect(sanitizeUserMessage("  hello  ")).toBe("hello");
  });

  it("handles entity-encoded payloads", () => {
    const input = "&#60;script&#62;";
    const result = sanitizeUserMessage(input);
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
  });
});

describe("safeExternalHref", () => {
  it("allows https URLs", () => {
    expect(safeExternalHref("https://example.com")).toBe("https://example.com");
  });

  it("allows http URLs", () => {
    expect(safeExternalHref("http://example.com")).toBe("http://example.com");
  });

  it("blocks javascript: URLs", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBe("#");
  });

  it("blocks data: URLs", () => {
    expect(safeExternalHref("data:text/html,<h1>hi</h1>")).toBe("#");
  });

  it("blocks vbscript: URLs", () => {
    expect(safeExternalHref("vbscript:foo")).toBe("#");
  });

  it("returns # for relative paths", () => {
    expect(safeExternalHref("/foo/bar")).toBe("#");
  });

  it("returns # for garbage input", () => {
    expect(safeExternalHref("not a url")).toBe("#");
  });
});
