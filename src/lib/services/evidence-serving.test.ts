import { describe, expect, it } from "vitest";
import { evidenceViewResponse } from "./evidence-serving";

describe("private evidence responses", () => {
  it("refuses unknown content instead of offering an original download", async () => {
    const response = evidenceViewResponse(Buffer.from("<html><script>alert(1)</script></html>"));
    expect(response.status).toBe(415);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).not.toContain("<script>");
  });

  it("refuses an old stored PDF with active content on read", async () => {
    const response = evidenceViewResponse(
      Buffer.from("%PDF-1.7\n1 0 obj << /OpenAction 2 0 R >> endobj")
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "active_pdf" });
  });

  it("serves identified evidence with private caching and browser isolation headers", () => {
    const response = evidenceViewResponse(
      Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe("inline");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });
});
