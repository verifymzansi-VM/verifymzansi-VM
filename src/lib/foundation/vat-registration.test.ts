import { describe, expect, it, vi } from "vitest";
import type { FoundationPublicApi } from "./public-api";
import { readVatRegistration, readVatStatusWording, vatStatusWording } from "./vat-registration";

vi.mock("server-only", () => ({}));

const publicApi = (answer: { data: unknown; error: unknown }) =>
  ({ rpc: vi.fn(async () => answer) }) as unknown as FoundationPublicApi;

describe("VAT wording from the database setting", () => {
  it("words each setting, and leaves the line out while undecided", () => {
    expect(vatStatusWording({ status: "not_registered", vat_number: null })).toBe(
      "not registered for VAT"
    );
    expect(vatStatusWording({ status: "registered", vat_number: "4123456789" })).toBe(
      "registered for VAT, VAT number 4123456789"
    );
    expect(vatStatusWording({ status: "undecided", vat_number: null })).toBeNull();
  });

  it("reads the public setting and refuses anything else", async () => {
    await expect(
      readVatRegistration(
        publicApi({ data: { status: "not_registered", vat_number: null }, error: null })
      )
    ).resolves.toEqual({ status: "not_registered", vat_number: null });
    await expect(
      readVatRegistration(publicApi({ data: { status: "exempt", vat_number: null }, error: null }))
    ).rejects.toThrow("Invalid foundation VAT setting");
    await expect(
      readVatRegistration(publicApi({ data: null, error: { code: "PGRST202" } }))
    ).rejects.toThrow("Foundation VAT setting unavailable");
  });

  it("gives no wording when the database cannot be reached, rather than guessing", async () => {
    // No connection settings in unit tests.
    await expect(readVatStatusWording()).resolves.toBeNull();
  });
});
