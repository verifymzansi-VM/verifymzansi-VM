import { describe, expect, it } from "vitest";
import { sanitizeTelemetry, telemetryUrl } from "./telemetry-privacy";

describe("telemetry privacy", () => {
  it.each([
    "https://example.test/auth/callback?token_hash=SYNTHETIC_SECRET#access_token=SYNTHETIC_SECRET",
    "/?code=SYNTHETIC_SECRET",
    "/login?returnUrl=%2Fauth%2Fcallback%3Fcode%3DSYNTHETIC_SECRET",
    "/api/admin/verification/evidence?artifactId=SYNTHETIC_SECRET",
  ])("strips complete query and fragment from %s", (url) => {
    expect(telemetryUrl(url)).not.toContain("SYNTHETIC_SECRET");
    expect(telemetryUrl(url)).toBe(url.split(/[?#]/)[0]);
  });
  it("sanitizes every event URL copy without mutating the source", () => {
    const url = "https://example.test/auth/callback?token_hash=SYNTHETIC_SECRET#SYNTHETIC_SECRET";
    const original = {
      request: {
        url,
        headers: { Referer: url },
        cookies: "SYNTHETIC_SECRET",
        data: { payload: "SYNTHETIC_SECRET" },
      },
      user: { email: "SYNTHETIC_SECRET" },
      breadcrumbs: [{ category: "navigation", data: { from: url, to: url } }],
      spans: [
        {
          description: `GET ${url}`,
          data: { "url.full": url, "http.url": url, "http.target": url, "http.referer": url },
        },
      ],
      transaction: url,
      exception: {
        values: [{ value: `Request failed: ${url}`, stacktrace: { frames: [{ filename: url }] } }],
      },
    };
    const result = sanitizeTelemetry(original);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SECRET");
    expect(result.user).toBeUndefined();
    expect(result.request.headers).toBeUndefined();
    expect(JSON.stringify(original)).toContain("SYNTHETIC_SECRET");
    expect(result.breadcrumbs[0].category).toBe("navigation");
    expect(result.spans[0].description).toBe("GET https://example.test/auth/callback");
  });
  it("preserves safe diagnostics and supports bounded nested values", () => {
    const event = {
      message: "Synthetic processing failure",
      level: "error",
      extra: { attempts: 2 },
    };
    expect(sanitizeTelemetry(event)).toEqual(event);
  });
  it("redacts separately collected SDK query and fragment attributes", () => {
    const event = {
      data: {
        "http.query": "?token_hash=SYNTHETIC_SECRET",
        "http.fragment": "#access_token=SYNTHETIC_SECRET",
        "url.query": "code=SYNTHETIC_SECRET",
        "url.fragment": "access_token=SYNTHETIC_SECRET",
        query_string: "SYNTHETIC_SECRET",
      },
      spans: [{ description: "GET /?code=SYNTHETIC_SECRET" }],
    };
    expect(JSON.stringify(sanitizeTelemetry(event))).not.toContain("SYNTHETIC_SECRET");
  });
  it("redacts embedded URL credentials", () => {
    expect(telemetryUrl("https://user:SYNTHETIC_SECRET@example.test/path")).not.toContain(
      "SYNTHETIC_SECRET"
    );
  });
});
