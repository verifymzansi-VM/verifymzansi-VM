import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  internalApiError,
  logApiError,
  parseAndValidateJsonRequest,
  parseJsonRequest,
} from "@/lib/utils/api";

describe("api utils", () => {
  it("parses JSON from Request.text()", async () => {
    const request = {
      text: vi.fn().mockResolvedValue('{"name":"Nomsa"}'),
    } as unknown as Request;

    await expect(parseJsonRequest<{ name: string }>(request)).resolves.toEqual({ name: "Nomsa" });
  });

  it("falls back to request.json() for lightweight test doubles", async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ ok: true }),
    };

    await expect(parseJsonRequest<{ ok: boolean }>(request)).resolves.toEqual({ ok: true });
  });

  it("returns a validation response with field details", async () => {
    const request = {
      json: vi.fn().mockResolvedValue({}),
    };

    const result = await parseAndValidateJsonRequest(
      request,
      z.object({
        filename: z.string().min(1, "filename is required"),
      })
    );

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected validation failure");
    }

    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toEqual({
      error: "Validation failed",
      details: { filename: "Invalid input: expected string, received undefined" },
    });
  });

  it("returns parsed data when validation succeeds", async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ area: "listing" }),
    };

    const result = await parseAndValidateJsonRequest(
      request,
      z.object({
        area: z.string(),
      })
    );

    expect(result).toEqual({
      success: true,
      data: { area: "listing" },
    });
  });

  it("logs sanitized error messages without throwing", () => {
    const error = vi.fn();

    logApiError({ error }, "Upload failed", new Error("boom"), { route: "/api/upload" });

    expect(error).toHaveBeenCalledWith("Upload failed", {
      route: "/api/upload",
      error: "boom",
    });
  });

  it("creates a standard internal error response", async () => {
    const response = internalApiError("Failed safely", 503);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Failed safely" });
  });
});
