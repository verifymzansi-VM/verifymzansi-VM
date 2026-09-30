import { describe, expect, it } from "vitest";
import {
  activeVersionIds,
  inspectSecretBindings,
} from "../../scripts/lib/cloudflare-deployment-bindings.mjs";

describe("deployed Worker security gate", () => {
  it("checks every traffic-serving version in the latest deployment", () => {
    expect(
      activeVersionIds([
        { created_on: "2026-09-01", versions: [{ version_id: "old", percentage: 100 }] },
        {
          created_on: "2026-09-02",
          versions: [
            { version_id: "a", percentage: 90 },
            { version_id: "b", percentage: 10 },
            { version_id: "unused", percentage: 0 },
          ],
        },
      ])
    ).toEqual(["a", "b"]);
  });
  it("rejects incomplete traffic metadata", () => {
    expect(() => activeVersionIds([])).toThrow();
    expect(() =>
      activeVersionIds([
        { created_on: "2026-09-02", versions: [{ version_id: "a", percentage: 0 }] },
      ])
    ).toThrow();
  });
  it("rejects plaintext substitutes for secret bindings and any bypass binding", () => {
    expect(
      inspectSecretBindings(
        [
          { name: "SERVICE_KEY", type: "plain_text" },
          { name: "TOKEN", type: "secret_text" },
          { name: "BYPASS", type: "plain_text" },
        ],
        ["SERVICE_KEY", "TOKEN", "OPS_SECRET"],
        ["BYPASS"]
      )
    ).toEqual({
      missing: ["OPS_SECRET"],
      unsafe: ["SERVICE_KEY"],
      forbidden: ["BYPASS"],
    });
  });
});
