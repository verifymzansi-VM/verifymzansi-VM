import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseAndValidateSearchParams, parseJsonRequest } from "./api";

describe("api utility - parseJsonRequest", () => {
  it("parses valid JSON successfully", async () => {
    const validJsonString = JSON.stringify({ name: "Testing", value: 123 });
    const request = new Request("http://localhost", {
      method: "POST",
      body: validJsonString,
    });

    const result = await parseJsonRequest(request);
    expect(result).toEqual({ name: "Testing", value: 123 });
  });

  it("returns null for invalid JSON to prevent 500 errors", async () => {
    const invalidJsonString = '{"name": "Testing", "value": 123'; // Missing closing brace
    const request = new Request("http://localhost", {
      method: "POST",
      body: invalidJsonString,
    });

    const result = await parseJsonRequest(request);
    expect(result).toBeNull();
  });

  it("returns null for empty request body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
    });

    const result = await parseJsonRequest(request);
    expect(result).toBeNull();
  });
});

describe("api utility - query fields", () => {
  it("keeps single values and collects repeated fields into a list", () => {
    const params = new URLSearchParams("q=shoes&tag=a&tag=b&tag=c");
    const result = parseAndValidateSearchParams(params, z.record(z.string(), z.unknown()));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ q: "shoes", tag: ["a", "b", "c"] });
  });

  it("never lets a repeated __proto__ field change the object's prototype", () => {
    const params = new URLSearchParams("__proto__=a&__proto__=b&constructor=c&name=Thando");
    const result = parseAndValidateSearchParams(params, z.any());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(Object.hasOwn(data, "__proto__")).toBe(true);
    expect(data.constructor).toBe("c");
    expect(data.name).toBe("Thando");
  });
});
