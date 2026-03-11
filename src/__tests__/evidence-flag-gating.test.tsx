import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Tests for feature-flag gating of the Evidence Desk:
 * 1. Evidence Desk page redirects when kyc_evidence_desk is disabled
 * 2. Evidence Desk page renders when kyc_evidence_desk is enabled
 * 3. KYC queue table hides Evidence button when flag is off
 * 4. KYC queue table shows Evidence button when flag is on
 */

// ── Mocks for Evidence Desk page (RSC) ──────────────────────

const mockRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new Error("NEXT_REDIRECT"); // simulate redirect throwing
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/verification",
  useSearchParams: () => new URLSearchParams(),
}));

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

const mockIsFeatureEnabled = vi.fn();
vi.mock("@/lib/services/feature-flags", () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  clearFlagCache: vi.fn(),
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ children, title }: { children?: React.ReactNode; title: string }) => (
    <div data-testid="page-header">
      {title}
      {children}
    </div>
  ),
}));

vi.mock("@/components/admin/evidence-desk", () => ({
  EvidenceDeskClient: () => <div data-testid="evidence-desk-client">Evidence Desk</div>,
}));

vi.mock("@/components/admin/kyc-inline-preview", () => ({
  KycInlinePreview: () => <div data-testid="kyc-inline-preview" />,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── Tests ────────────────────────────────────────────────────

describe("Feature-flag gating: Evidence Desk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "admin-1", app_metadata: { role: "admin" }, is_anonymous: false } },
          error: null,
        }),
      },
    });
  });

  describe("Evidence Desk page", () => {
    it("redirects to /admin/verification when kyc_evidence_desk is disabled", async () => {
      mockIsFeatureEnabled.mockResolvedValue(false);

      // Dynamic import because the module reads mocks at import time
      const { default: EvidenceDeskPage } = await import("@/app/admin/verification/evidence/page");

      await expect(EvidenceDeskPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
        "NEXT_REDIRECT"
      );

      expect(mockRedirect).toHaveBeenCalledWith("/admin/verification");
    });

    it("renders Evidence Desk when kyc_evidence_desk is enabled", async () => {
      mockIsFeatureEnabled.mockResolvedValue(true);

      const { default: EvidenceDeskPage } = await import("@/app/admin/verification/evidence/page");

      const ui = await EvidenceDeskPage({ searchParams: Promise.resolve({}) });
      render(ui);

      expect(screen.getByTestId("evidence-desk-client")).toBeDefined();
    });
  });

  describe("KYC Queue Table – Evidence button visibility", () => {
    const MOCK_STEP = {
      id: "step-1",
      user_id: "seller-1",
      step_type: "id_doc",
      status: "pending",
      created_at: "2025-01-01T00:00:00Z",
      account_display_name: "Test Account",
      seller_display_name: "Test Account",
      seller_verification_status: "pending",
    };

    it("hides Evidence button when evidenceDeskEnabled is false", async () => {
      // Dynamic import to pick up mocks
      const { KycQueueTable } = await import("@/components/admin/kyc-queue-table");

      render(
        <KycQueueTable
          steps={[MOCK_STEP]}
          onDecisionComplete={vi.fn()}
          evidenceDeskEnabled={false}
        />
      );

      expect(screen.queryByTitle("View Evidence")).toBeNull();
    });

    it("shows Evidence button when evidenceDeskEnabled is true", async () => {
      const { KycQueueTable } = await import("@/components/admin/kyc-queue-table");

      render(
        <KycQueueTable
          steps={[MOCK_STEP]}
          onDecisionComplete={vi.fn()}
          evidenceDeskEnabled={true}
        />
      );

      expect(screen.getByTitle("View Evidence")).toBeDefined();
    });
  });
});
