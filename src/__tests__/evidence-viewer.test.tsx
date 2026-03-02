/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// Mock UI components
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: { children: React.ReactNode }) => (
    <div data-testid="card" {...props}>
      {children}
    </div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();

// Preserve the URL constructor while mocking createObjectURL/revokeObjectURL
const OriginalURL = globalThis.URL;
Object.defineProperty(OriginalURL, "createObjectURL", {
  value: mockCreateObjectURL,
  writable: true,
});
Object.defineProperty(OriginalURL, "revokeObjectURL", {
  value: mockRevokeObjectURL,
  writable: true,
});

const { EvidenceViewer } = await import("@/components/admin/evidence-viewer");

const artifact = {
  id: "art-1",
  step_type: "identity",
  artifact_kind: "photo",
  r2_key: "kyc/test/photo1.jpg",
  content_type: "image/jpeg",
  file_size_bytes: 150_000,
  status: "pending",
  created_at: "2025-01-01T00:00:00Z",
  purge_after: null,
  sha256: "abc123def",
};

describe("EvidenceViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render artifact metadata", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    render(<EvidenceViewer artifact={artifact} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    // Should display basic artifact info
    expect(screen.getByText(/identity/i) || screen.getByText(/photo/i)).toBeTruthy();
  });

  it("should create blob URL after fetching evidence", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    render(<EvidenceViewer artifact={artifact} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/verification/evidence")
      );
    });
  });

  it("should handle fetch error gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(<EvidenceViewer artifact={artifact} />);

    await waitFor(() => {
      // Should show error state, not crash
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it("should revoke previous blob URL when new one is created", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    const { rerender } = render(<EvidenceViewer artifact={artifact} />);

    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalled();
    });

    // Update with different artifact to trigger cleanup
    const artifact2 = { ...artifact, id: "art-2", r2_key: "kyc/test/photo2.jpg" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img2"], { type: "image/jpeg" })),
    });

    rerender(<EvidenceViewer artifact={artifact2} />);

    await waitFor(() => {
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });
  });
});
