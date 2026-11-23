import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredContactRows,
  getConfiguredIdentityRows,
  getConfiguredLegalIdentityRows,
  getConfiguredLegalNoticeRows,
  getTrustPublicConfig,
  registeredAddressNote,
} from "./trust-public-config";

vi.mock("server-only", () => ({}));

describe("trust public config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders default legal identity fields", () => {
    const rows = getConfiguredIdentityRows(getTrustPublicConfig());
    const legalRows = getConfiguredLegalIdentityRows(getTrustPublicConfig());
    const contactRows = getConfiguredContactRows(getTrustPublicConfig());

    expect(rows).toContainEqual({
      label: "Registered name",
      value: "VERIFYMZANSI (PTY) LTD",
    });
    expect(rows).toContainEqual({
      label: "CIPC registration number",
      value: "2026/155305/07",
    });
    // No page shows a street address; the registered address is only named.
    expect(rows.map((row) => row.label)).not.toContain("Registered address");
    expect(rows).toContainEqual({
      label: "Information Officer phone",
      value: "0717484185",
    });
    expect(rows).toContainEqual({
      label: "Information Officer WhatsApp",
      value: "0717484185",
    });
    expect(legalRows.length).toBeGreaterThan(0);
    expect(contactRows).toContainEqual({
      label: "Security contact",
      value: "security@verifymzansi.com",
    });
    expect(rows).toContainEqual({
      label: "POPIA contact",
      value: "privacy@verifymzansi.com",
    });
  });

  it("shows the director and Information Officer once when they are the same person", () => {
    const rows = getConfiguredLegalNoticeRows(getTrustPublicConfig());

    expect(rows).toContainEqual({
      label: "Director and Information Officer",
      value: "Senzo Mqondisi Mhlongo",
    });
    expect(rows.filter((row) => row.value === "Senzo Mqondisi Mhlongo")).toHaveLength(1);
    expect(rows.map((row) => row.label)).not.toContain("Responsible officer");
    expect(registeredAddressNote()).toBe("Our registered address, as recorded at CIPC");
  });

  it("keeps two rows when the director and Information Officer differ", () => {
    vi.stubEnv("VERIFYMZANSI_INFORMATION_OFFICER_NAME", "Synthetic Officer");

    const rows = getConfiguredLegalNoticeRows(getTrustPublicConfig());

    expect(rows).toContainEqual({ label: "Director", value: "Senzo Mqondisi Mhlongo" });
    expect(rows).toContainEqual({ label: "Information Officer", value: "Synthetic Officer" });
    expect(rows.map((row) => row.label)).not.toContain("Director and Information Officer");
  });

  it("renders configured legal identity fields", () => {
    vi.stubEnv("VERIFYMZANSI_LEGAL_NAME", "VerifyMzansi (Pty) Ltd");
    vi.stubEnv("VERIFYMZANSI_CIPC_NUMBER", "2026/123456/07");
    vi.stubEnv("VERIFYMZANSI_BUSINESS_ADDRESS", "1 Main Road, Cape Town");

    const rows = getConfiguredIdentityRows(getTrustPublicConfig());

    expect(rows).toContainEqual({
      label: "Registered name",
      value: "VerifyMzansi (Pty) Ltd",
    });
    expect(rows).toContainEqual({
      label: "CIPC registration number",
      value: "2026/123456/07",
    });
    // Even when set, an address setting is never shown.
    expect(JSON.stringify(rows)).not.toContain("Main Road");
  });
});
