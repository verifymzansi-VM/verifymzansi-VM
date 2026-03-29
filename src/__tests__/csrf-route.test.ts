import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/csrf/route";

describe("GET /api/csrf", () => {
  it("returns a token, refreshes the cookie, and disables caching", async () => {
    const token = "a".repeat(64);
    const request = new NextRequest("https://verifymzansi.com/api/csrf", {
      headers: {
        cookie: `vm_csrf=${token}`,
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ token });
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, no-cache, must-revalidate"
    );
    expect(response.headers.get("set-cookie")).toContain(`vm_csrf=${token}`);
    expect(response.headers.get("set-cookie")).toContain("Path=/");
  });
});
