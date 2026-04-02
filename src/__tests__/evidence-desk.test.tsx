import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/**
 * Tests for EvidenceDeskClient component:
 * - Renders search form with step/user ID inputs
 * - Shows empty state when no data loaded
 * - Auto-fetches when initial params provided
 * - Displays metadata, steps, and account profile on load
 * - Shows error toast on API failure
 */

// Mock child components to isolate unit
vi.mock("@/components/admin/evidence-viewer", () => ({
  EvidenceViewer: ({ artifact }: { artifact: { id: string } }) => (
    <div data-testid="evidence-viewer">Viewing {artifact.id}</div>
  ),
}));

vi.mock("@/components/admin/evidence-metadata-panel", () => ({
  EvidenceMetadataPanel: () => <div data-testid="metadata-panel">Metadata Panel</div>,
}));

vi.mock("@/components/admin/evidence-decision-controls", () => ({
  EvidenceDecisionControls: () => <div data-testid="decision-controls">Decision Controls</div>,
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import { EvidenceDeskClient } from "@/components/admin/evidence-desk";

// ── Mock data ────────────────────────────────────────────────

const METADATA_RESPONSE = {
  steps: [
    {
      id: "step-1",
      step_type: "id_doc",
      status: "pending",
      risk_level: "low",
      risk_score: 10,
      auto_status: null,
      reason_code: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: "2025-01-01T00:00:00Z",
      metadata: null,
    },
  ],
  artifacts: [
    {
      id: "art-1",
      step_type: "id_doc",
      artifact_kind: "id_doc",
      r2_key: "kyc/seller-1/id_doc.enc",
      content_type: "image/jpeg",
      file_size_bytes: 1024,
      status: "active",
      created_at: "2025-01-01T00:00:00Z",
      purge_after: null,
      sha256: "abc123",
    },
  ],
  providerResults: [],
  riskSignals: [],
  accountProfile: {
    display_name: "Test Account",
    account_verification_status: "pending_review",
    account_status: "active",
    strikes: 0,
    legal_hold: false,
    location_province: "Gauteng",
    location_city: "Johannesburg",
  },
  sellerProfile: {
    display_name: "Test Account",
    account_verification_status: "pending_review",
    account_status: "active",
    strikes: 0,
    legal_hold: false,
    location_province: "Gauteng",
    location_city: "Johannesburg",
  },
  accessLog: [],
};

// ── Tests ────────────────────────────────────────────────────

describe("EvidenceDeskClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders search form with Step ID and User ID inputs", () => {
    render(<EvidenceDeskClient />);

    expect(screen.getByLabelText(/Step ID/i)).toBeDefined();
    expect(screen.getByLabelText(/User ID/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /Load Evidence/i })).toBeDefined();
  });

  it("shows empty state when no data is loaded", () => {
    render(<EvidenceDeskClient />);

    expect(screen.getByText(/Enter a Step ID or User ID above/i)).toBeDefined();
  });

  it("disables Load Evidence button when both inputs are empty", () => {
    render(<EvidenceDeskClient />);

    const btn = screen.getByRole("button", { name: /Load Evidence/i });
    expect(btn).toHaveAttribute("disabled");
  });

  it("auto-fetches and displays metadata when initialStepId is provided", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => METADATA_RESPONSE,
    } as Response);

    render(<EvidenceDeskClient initialStepId="step-1" />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/verification/evidence/metadata",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ stepId: "step-1" }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Test Account")).toBeDefined();
    });

    // Account profile location
    expect(screen.getByText(/Johannesburg/)).toBeDefined();

    // Step displayed
    expect(screen.getByText(/id doc/i)).toBeDefined();

    // Evidence viewer rendered for auto-selected artifact
    expect(screen.getByTestId("evidence-viewer")).toBeDefined();

    // Metadata panel rendered
    expect(screen.getByTestId("metadata-panel")).toBeDefined();

    // Decision controls rendered for pending step
    expect(screen.getByTestId("decision-controls")).toBeDefined();
  });

  it("shows error toast when API returns an error", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Forbidden" }),
    } as Response);

    render(<EvidenceDeskClient initialStepId="step-1" />);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Error loading evidence",
          variant: "destructive",
        })
      );
    });
  });

  it("fetches metadata on form submit with user ID", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => METADATA_RESPONSE,
    } as Response);

    render(<EvidenceDeskClient />);

    const userIdInput = screen.getByLabelText(/User ID/i);
    fireEvent.change(userIdInput, { target: { value: "seller-1" } });

    const btn = screen.getByRole("button", { name: /Load Evidence/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/verification/evidence/metadata",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ userId: "seller-1" }),
        })
      );
    });
  });

  it("shows no-artifact placeholder when artifacts list is empty", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...METADATA_RESPONSE,
        artifacts: [],
      }),
    } as Response);

    render(<EvidenceDeskClient initialStepId="step-1" />);

    await waitFor(() => {
      expect(screen.getByText(/No artifact selected/i)).toBeDefined();
    });
  });

  it("aligns the selected artifact with the selected step", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...METADATA_RESPONSE,
        steps: [
          {
            ...METADATA_RESPONSE.steps[0],
            id: "step-location",
            step_type: "location",
          },
          METADATA_RESPONSE.steps[0],
        ],
        artifacts: [
          {
            ...METADATA_RESPONSE.artifacts[0],
            id: "art-id",
            step_type: "id_doc",
            created_at: "2025-01-01T00:00:00Z",
          },
          {
            ...METADATA_RESPONSE.artifacts[0],
            id: "art-location",
            step_type: "location",
            artifact_kind: "proof_of_address",
            created_at: "2025-01-02T00:00:00Z",
          },
        ],
      }),
    } as Response);

    render(<EvidenceDeskClient initialUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("evidence-viewer")).toHaveTextContent("Viewing art-location");
    });

    fireEvent.click(screen.getAllByRole("button", { name: /id doc/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("evidence-viewer")).toHaveTextContent("Viewing art-id");
    });
  });
});
