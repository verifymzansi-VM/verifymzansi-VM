import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseAndValidateFormData, parseAndValidateSearchParams, parseJsonRequest } from "./api";

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

describe("api utility - form and query fields", () => {
  it("keeps single values and collects repeated fields into a list", () => {
    const params = new URLSearchParams("q=shoes&tag=a&tag=b&tag=c");
    const result = parseAndValidateSearchParams(params, z.record(z.string(), z.unknown()));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ q: "shoes", tag: ["a", "b", "c"] });
  });

  it("never lets a field named __proto__ or constructor change the object's prototype", () => {
    const form = new FormData();
    form.append("__proto__", new Blob(["x"]), "upload.txt");
    form.append("constructor", "polluted");
    form.append("name", "Thando");
    const result = parseAndValidateFormData(form, z.any());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(Object.hasOwn(data, "__proto__")).toBe(true);
    expect(data.constructor).toBe("polluted");
    expect(data.name).toBe("Thando");
  });

  it("keeps a repeated __proto__ field as plain data", () => {
    const params = new URLSearchParams("__proto__=a&__proto__=b");
    const result = parseAndValidateSearchParams(params, z.record(z.string(), z.unknown()));
    expect(result.success).toBe(true);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});
