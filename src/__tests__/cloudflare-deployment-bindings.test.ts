import { describe, expect, it } from "vitest";
import {
  activeVersionIds,
  inspectSecretBindings,
  inspectPublicBindings,
} from "../../scripts/lib/cloudflare-deployment-bindings.mjs";

describe("deployed Worker security gate", () => {
  it("detects stale project/key pairs, missing selectors, wrong types and duplicate bindings without returning values", () => {
    const expected = {
      URL: "https://new.supabase.co",
      KEY: "synthetic-public-key",
      BACKEND: "foundation",
    };
    expect(
      inspectPublicBindings(
        [
          { name: "URL", type: "plain_text", text: "https://old.supabase.co" },
          { name: "KEY", type: "plain_text", text: "private-marker" },
        ],
        expected
      )
    ).toEqual(["URL", "KEY", "BACKEND"]);
    const bindings = Object.entries(expected).map(([name, text]) => ({
      name,
      text,
      type: "plain_text",
    }));
    expect(inspectPublicBindings(bindings, expected)).toEqual([]);
    expect(inspectPublicBindings([...bindings, bindings[0]], expected)).toEqual(["URL"]);
    expect(
      inspectPublicBindings(
        bindings.map((binding) => ({ ...binding, type: "secret_text" })),
        expected
      )
    ).toEqual(["URL", "KEY", "BACKEND"]);
    expect(() => inspectPublicBindings(undefined, expected)).toThrow("Missing");
  });
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
