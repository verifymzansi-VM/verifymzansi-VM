import { describe, expect, it } from "vitest";
import { parseJsonRequest } from "./api";

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
