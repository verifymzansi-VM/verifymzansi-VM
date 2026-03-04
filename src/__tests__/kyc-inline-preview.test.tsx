/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: React.ReactNode;
    asChild?: boolean;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockCreateObjectURL = vi.fn(() => "blob:mock-thumb-url");
const mockRevokeObjectURL = vi.fn();

const OriginalURL = globalThis.URL;
Object.defineProperty(OriginalURL, "createObjectURL", {
  value: mockCreateObjectURL,
  writable: true,
});
Object.defineProperty(OriginalURL, "revokeObjectURL", {
  value: mockRevokeObjectURL,
  writable: true,
});

// Mock IntersectionObserver — immediately triggers visibility
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe = () => {
    mockObserve();
    // Simulate immediate intersection
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  };
  disconnect = mockDisconnect;
  unobserve = vi.fn();
}

vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

const { KycInlinePreview } = await import("@/components/admin/kyc-inline-preview");

// ── Test data ────────────────────────────────────────────────

const MOCK_METADATA_RESPONSE = {
  steps: [{ id: "step-1", step_type: "id_doc", status: "pending" }],
  artifacts: [
    {
      id: "art-1",
      step_type: "id_doc",
      artifact_kind: "document",
      r2_key: "kyc/test/id.jpg",
      content_type: "image/jpeg",
      file_size_bytes: 120_000,
      status: "encrypted",
      created_at: "2025-01-01T00:00:00Z",
      purge_after: null,
      sha256: "abc123",
    },
  ],
  providerResults: [],
  riskSignals: [],
  sellerProfile: null,
  accessLog: [],
};

// ── Tests ────────────────────────────────────────────────────

describe("KycInlinePreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state then fetches metadata and blob", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_METADATA_RESPONSE),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
      });

    render(
      <KycInlinePreview
        stepId="step-1"
        userId="user-1"
        stepType="id_doc"
        onClickPreview={vi.fn()}
      />
    );

    // Should have called IntersectionObserver
    expect(mockObserve).toHaveBeenCalled();

    // Wait for metadata + blob fetch
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // First call = metadata
    expect(mockFetch.mock.calls[0][0]).toContain("/api/admin/verification/evidence/metadata");
    // Second call = blob
    expect(mockFetch.mock.calls[1][0]).toContain(
      "/api/admin/verification/evidence?artifactId=art-1"
    );

    // Should create a blob URL for the thumbnail
    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalled();
    });
  });

  it("shows 'No document' when no artifacts match", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          ...MOCK_METADATA_RESPONSE,
          artifacts: [],
        }),
    });

    render(
      <KycInlinePreview
        stepId="step-1"
        userId="user-1"
        stepType="id_doc"
        onClickPreview={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/no document/i)).toBeDefined();
    });
  });

  it("shows error state when metadata fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(
      <KycInlinePreview
        stepId="step-1"
        userId="user-1"
        stepType="id_doc"
        onClickPreview={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/failed to load metadata/i)).toBeDefined();
    });
  });

  it("calls onClickPreview with artifact when thumbnail is clicked", async () => {
    const onClickPreview = vi.fn();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_METADATA_RESPONSE),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
      });

    render(
      <KycInlinePreview
        stepId="step-1"
        userId="user-1"
        stepType="id_doc"
        onClickPreview={onClickPreview}
      />
    );

    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalled();
    });

    // Click the container
    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(onClickPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "art-1",
        step_type: "id_doc",
      })
    );
  });

  it("blocks right-click context menu", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_METADATA_RESPONSE),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
      });

    render(
      <KycInlinePreview
        stepId="step-1"
        userId="user-1"
        stepType="id_doc"
        onClickPreview={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalled();
    });

    const btn = screen.getByRole("button");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const prevented = !btn.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it("renders PDF icon for PDF content type", async () => {
    const pdfMetadata = {
      ...MOCK_METADATA_RESPONSE,
      artifacts: [
        {
          ...MOCK_METADATA_RESPONSE.artifacts[0],
          content_type: "application/pdf",
        },
      ],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(pdfMetadata),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["%PDF"], { type: "application/pdf" })),
      });

    render(
      <KycInlinePreview
        stepId="step-1"
        userId="user-1"
        stepType="id_doc"
        onClickPreview={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalled();
    });

    // Should render PDF label
    expect(screen.getByText("PDF")).toBeDefined();
  });
});
