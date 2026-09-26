import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrustSafetyPage from "@/app/trust-safety/page";
import SafetyCentrePage from "@/app/safety/page";
import PrivacyPolicyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import PricingPage from "@/app/pricing/page";
import PaiaManualPage from "@/app/paia/page";

vi.mock("server-only", () => ({}));
vi.mock("@/components/layout/header", () => ({ Header: () => <div>Header</div> }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => <div>Footer</div> }));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("No database in unit tests");
  },
}));
vi.mock("@/components/billing/retail-pricing", () => ({
  RetailPricing: () => <div>Plan grid</div>,
}));

describe("public trust pages", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders Trust & Safety with public legal identity details", () => {
    render(<TrustSafetyPage />);

    expect(screen.getByRole("heading", { name: "Trust & Safety" })).toBeInTheDocument();
    expect(screen.getByText(/Verification helps reduce risk/i)).toBeInTheDocument();
    expect(screen.getByText("Registered name")).toBeInTheDocument();
    expect(screen.getByText("VERIFYMZANSI (PTY) LTD")).toBeInTheDocument();
    expect(screen.getByText("CIPC registration number")).toBeInTheDocument();
    expect(screen.getByText("2026/155305/07")).toBeInTheDocument();
    expect(screen.getAllByText("Senzo Mqondisi Mhlongo").length).toBeGreaterThan(0);
    expect(screen.getByText("privacy@verifymzansi.com")).toBeInTheDocument();
    expect(screen.getAllByText("security@verifymzansi.com").length).toBeGreaterThan(0);
    expect(screen.getByText(/VerifyMzansi verifies people who post/i)).toBeInTheDocument();
    // The verification journey and every trust tier label are explained.
    for (const step of ["Phone confirmed", "ID & selfie reviewed", "Location checked"]) {
      expect(screen.getByRole("heading", { name: step })).toBeInTheDocument();
    }
    for (const label of ["Pending Review", "Incomplete", "Unregistered", "ID Reviewed Pro"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("renders configured legal details on Trust & Safety", () => {
    vi.stubEnv("VERIFYMZANSI_LEGAL_NAME", "VerifyMzansi (Pty) Ltd");
    vi.stubEnv("VERIFYMZANSI_CIPC_NUMBER", "2026/123456/07");

    render(<TrustSafetyPage />);

    expect(screen.getByText("Registered name")).toBeInTheDocument();
    expect(screen.getByText("VerifyMzansi (Pty) Ltd")).toBeInTheDocument();
    expect(screen.getByText("CIPC registration number")).toBeInTheDocument();
    expect(screen.getByText("2026/123456/07")).toBeInTheDocument();
  });

  it("renders the Safety Centre with report and appeal guidance", () => {
    render(<SafetyCentrePage />);

    expect(screen.getByRole("heading", { name: "Safety Centre" })).toBeInTheDocument();
    expect(screen.getByText(/Never pay deposits/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Reports, disputes, and appeals" })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Report a problem/i })[0]).toHaveAttribute(
      "href",
      "/contact?topic=fraud_report"
    );
    expect(screen.getByRole("link", { name: /Scam Alerts/i })).toHaveAttribute(
      "href",
      "/safety/scam-alerts"
    );
  });

  it("renders specific POPIA and verification data language", () => {
    render(<PrivacyPolicyPage />);

    expect(
      screen.getByRole("heading", { name: "How verification data is used" })
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "On this page" })).toBeInTheDocument();
    expect(screen.getByText(/ID numbers, ID document images, selfies/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sensitive data handling" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Third parties" })).toBeInTheDocument();
    expect(screen.getByText(/If we discover a data breach/i)).toBeInTheDocument();
    expect(screen.getByText(/targeted for deletion within 30 days/i)).toBeInTheDocument();
  });

  it("renders payment and verification disclaimers in terms", () => {
    render(<TermsPage />);

    expect(screen.getByRole("heading", { name: "Verification signals" })).toBeInTheDocument();
    expect(screen.getByText(/does not guarantee that a user/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payments & billing" })).toBeInTheDocument();
    expect(screen.getByText(/paid content is rejected/i)).toBeInTheDocument();
    expect(screen.getByText(/Plans do not auto-renew/i)).toBeInTheDocument();
  });

  it("renders payment transparency on pricing", async () => {
    render(await PricingPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Start free. Then one simple price." })
    ).toBeInTheDocument();
    // Payment and refund transparency now lives in the "How billing works" FAQ.
    expect(screen.getByText("How billing works")).toBeInTheDocument();
    expect(screen.getByText("How do I pay?")).toBeInTheDocument();
    expect(screen.getByText("What if my paid post is rejected?")).toBeInTheDocument();
  });

  it("renders PAIA request guidance", () => {
    render(<PaiaManualPage />);

    expect(screen.getByRole("heading", { name: "PAIA Manual" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Legal identity" })).toBeInTheDocument();
    expect(screen.getByText("2026/155305/07")).toBeInTheDocument();
    expect(screen.getByText(/Information Regulator South Africa/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open data-subject request form/i })).toHaveAttribute(
      "href",
      "/dsar"
    );
  });
});
