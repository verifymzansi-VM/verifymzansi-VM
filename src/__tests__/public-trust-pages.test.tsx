import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrustSafetyPage from "@/app/trust-safety/page";
import SafetyCentrePage from "@/app/safety/page";
import PrivacyPolicyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import PricingPage from "@/app/pricing/page";
import PaiaManualPage from "@/app/paia/page";
import { readCurrentPublishedPostingTerms } from "@/lib/legal/current-posting-terms";
import { getPublishedPostingTerms } from "@/lib/legal/published-posting-terms";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/legal/current-posting-terms", () => ({
  readCurrentPublishedPostingTerms: vi.fn(),
}));
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
// The VAT status comes from the database setting (api.get_vat_registration).
vi.mock("@/lib/foundation/vat-registration", () => ({
  readVatStatusWording: vi.fn(async () => "not registered for VAT"),
}));
vi.mock("@/components/billing/pricing-offers", () => ({
  PricingOffers: () => <div>Plan grid</div>,
}));

describe("public trust pages", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(readCurrentPublishedPostingTerms).mockReset();
  });

  it("renders Trust & Safety with public legal identity details", async () => {
    render(await TrustSafetyPage());

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
    expect(screen.getByText("VAT status: not registered for VAT")).toBeInTheDocument();
    // The verification journey and every trust tier label are explained.
    for (const step of ["Phone verified", "ID & selfie reviewed", "Area shared"]) {
      expect(screen.getByRole("heading", { name: step })).toBeInTheDocument();
    }
    // True on every ID check setting (staff or Didit).
    expect(
      screen.getByText("Checked by our team or our verification partner, then encrypted.")
    ).toBeInTheDocument();
    for (const label of ["Pending review", "Incomplete", "Unregistered", "ID reviewed"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("renders configured legal details on Trust & Safety", async () => {
    vi.stubEnv("VERIFYMZANSI_LEGAL_NAME", "VerifyMzansi (Pty) Ltd");
    vi.stubEnv("VERIFYMZANSI_CIPC_NUMBER", "2026/123456/07");

    render(await TrustSafetyPage());

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
    expect(screen.getByRole("heading", { name: "What other people can see" })).toBeInTheDocument();
    expect(screen.getByText(/If we discover a data breach/i)).toBeInTheDocument();
    // Keep-for periods as the applied database rules run them
    // (20261122022323_identity_keep_for.sql).
    expect(screen.getAllByText(/deleted 90 days after you close it/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/keeps only the one-way code/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/7 years after the end of the tax year/i)).toBeInTheDocument();
    expect(
      screen.getByText(/contact form are deleted 12 months after they are resolved/i)
    ).toBeInTheDocument();
    // Section 18: who is responsible, what is required, and where data goes.
    expect(screen.getByRole("heading", { name: "Who we are" })).toBeInTheDocument();
    expect(
      screen.getByText(/VERIFYMZANSI \(PTY\) LTD, registration number 2026\/155305\/07/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Legal notices go to legal@verifymzansi.com/)).toBeInTheDocument();
    expect(screen.getByText(/Giving us information is voluntary/i)).toBeInTheDocument();
    expect(screen.getByText(/Some information comes from others/i)).toBeInTheDocument();
    for (const provider of [
      "Supabase",
      "Cloudflare",
      "Didit",
      "Resend",
      "Zoho",
      "Africa's Talking",
      "Sentry",
      "Google",
    ])
      expect(screen.getByText(new RegExp(`^${provider}:`))).toBeInTheDocument();
    expect(
      screen.getByText(/to the United Kingdom, the European Union, the United States and Kenya/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ask a person to look again at an automatic ID decision/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/eServices portal/)).toBeInTheDocument();
    // Cookies and browser storage, as the site sets them.
    expect(
      screen.getByRole("heading", { name: "Cookies and browser storage" })
    ).toBeInTheDocument();
    expect(screen.getByText(/vm_acq, 30 days/)).toBeInTheDocument();
    expect(
      screen.getByText(/so a partner can be credited and we can see which channels bring sign-ups/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/If you sign up, this is stored with your account and deleted with it/)
    ).toBeInTheDocument();
    // A ban keeps the full record only for an accepted ID; the ID photo still goes.
    expect(
      screen.getAllByText(
        /If your ID number is banned, the one-way code is kept for 5 years from the ban; if your ID had been accepted, your selfie, encrypted ID number, the names on your ID and your verified phone numbers are kept for those 5 years too\. Your ID photo is still deleted 30 days after the decision\./
      ).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        /no longer linked to your account; an invoice made out to you keeps the name and address on it/
      )
    ).toBeInTheDocument();
    // Never claims what the site does not do.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/records a replay/i);
    expect(text).toMatch(/We do not record replays of your screen/);
    expect(text).not.toMatch(/and logged so we can stop/i);
    expect(text).not.toMatch(/30 days after the case decision/i);
    // Never a street address or the owner's name on this page.
    expect(text).not.toContain("Senzo");
  });

  it("renders payment and verification disclaimers in terms", async () => {
    render(await TermsPage());

    expect(screen.getByRole("heading", { name: "What our checks mean" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Our role" })).toBeInTheDocument();
    expect(screen.getByText(/not a party to any deal between users/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Who we are" })).toBeInTheDocument();
    expect(screen.getByText(/does not guarantee that a user/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Slots & prices" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Refunds & cancelling" })).toBeInTheDocument();
    expect(screen.getByText(/A rejected post is not a reason for a refund/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing renews automatically/i)).toBeInTheDocument();
    // ECTA s43 details and the takedown section.
    expect(
      screen.getByText("Private company, registered in South Africa with CIPC")
    ).toBeInTheDocument();
    expect(screen.getByText("verifymzansi.com")).toBeInTheDocument();
    // Legal notices go to legal@; the registered address is only named, and
    // the registration number is not repeated in it.
    expect(
      screen.getByText(
        "Our registered address, as recorded at CIPC. Legal notices may also be sent by email to legal@verifymzansi.com; we confirm receipt."
      )
    ).toBeInTheDocument();
    expect(document.body.textContent?.split("2026/155305/07")).toHaveLength(2);
    // The director is also the Information Officer: one row, the name once.
    expect(screen.getByText("Director and Information Officer")).toBeInTheDocument();
    expect(document.body.textContent?.split("Senzo Mqondisi Mhlongo")).toHaveLength(2);
    for (const label of ["Responsible officer", "Information Officer", "Directors"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "legal@verifymzansi.com" })).toHaveAttribute(
      "href",
      "mailto:legal@verifymzansi.com"
    );
    // The registered address is only named; no street address row is shown.
    expect(screen.queryByText("Registered address")).not.toBeInTheDocument();
    expect(screen.getByText(/use your browser's Print or Save as PDF/)).toBeInTheDocument();
  });

  it("renders the immutable current document after the foundation is explicitly bound", async () => {
    vi.stubEnv("FOUNDATION_SUPABASE_URL", "https://synthetic-target.supabase.co");
    vi.mocked(readCurrentPublishedPostingTerms).mockResolvedValue(
      getPublishedPostingTerms("posting-v1")
    );
    render(await TermsPage());
    expect(readCurrentPublishedPostingTerms).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Updated November 2026")).toBeInTheDocument();
    expect(screen.queryByText(/Posting terms ·/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What our checks mean" })).toBeInTheDocument();
  });

  it.each(["missing", "failed"])(
    "does not substitute mutable terms when the current document is %s",
    async (kind) => {
      vi.stubEnv("FOUNDATION_SUPABASE_URL", "https://synthetic-target.supabase.co");
      if (kind === "missing") vi.mocked(readCurrentPublishedPostingTerms).mockResolvedValue(null);
      else
        vi.mocked(readCurrentPublishedPostingTerms).mockRejectedValue(
          new Error("private provider detail")
        );
      render(await TermsPage());
      expect(
        screen.getByRole("heading", { name: "Terms temporarily unavailable" })
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Payments & billing" })).not.toBeInTheDocument();
      expect(screen.queryByText("private provider detail")).not.toBeInTheDocument();
    }
  );

  it("renders payment transparency on pricing", async () => {
    render(await PricingPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Start free. Then one simple price." })
    ).toBeInTheDocument();
    // Payment and refund transparency now lives in the "How billing works" FAQ.
    expect(screen.getByText("How billing works")).toBeInTheDocument();
    expect(screen.getByText("How do I pay?")).toBeInTheDocument();
    expect(screen.getByText("What if my paid post is rejected?")).toBeInTheDocument();
    expect(screen.getByText(/VAT status: not registered for VAT\./)).toBeInTheDocument();
  });

  it("renders PAIA request guidance", () => {
    render(<PaiaManualPage />);

    expect(screen.getByRole("heading", { name: "PAIA Manual" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Company and contact details" })
    ).toBeInTheDocument();
    expect(screen.getByText("Deputy Information Officer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Updates to this manual" })).toBeInTheDocument();
    expect(screen.getByText("2026/155305/07")).toBeInTheDocument();
    // Each fact once: the registration number is not repeated in the address,
    // and the director and Information Officer share one row.
    expect(document.body.textContent?.split("2026/155305/07")).toHaveLength(2);
    expect(screen.getByText("Our registered address, as recorded at CIPC")).toBeInTheDocument();
    expect(screen.getByText("Director and Information Officer")).toBeInTheDocument();
    expect(document.body.textContent?.split("Senzo Mqondisi Mhlongo")).toHaveLength(2);
    expect(screen.queryByText("Responsible officer")).not.toBeInTheDocument();
    expect(screen.getByText(/Information Regulator South Africa/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open data-subject request form/i })).toHaveAttribute(
      "href",
      "/dsar"
    );
  });
});
