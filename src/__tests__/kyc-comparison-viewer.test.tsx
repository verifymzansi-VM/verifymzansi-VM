/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    unoptimized: _unoptimized,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) =>
    React.createElement("img", { alt, src, ...props }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: React.PropsWithChildren<{ open: boolean }>) =>
    open ? React.createElement("div", { "data-testid": "dialog" }, children) : null,
  DialogContent: ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children),
  DialogHeader: ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children),
  DialogTitle: ({ children }: React.PropsWithChildren) => React.createElement("h2", null, children),
  DialogDescription: ({ children }: React.PropsWithChildren) =>
    React.createElement("p", null, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", { onClick, ...props }, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) =>
    React.createElement("span", props, children),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", props, children),
  CardContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", props, children),
  CardHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", props, children),
  CardTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) =>
    React.createElement("h3", props, children),
}));

vi.mock("lucide-react", () => ({
  Loader2: () => React.createElement("span", null, "loading"),
  FileText: () => React.createElement("span", null, "file"),
  AlertTriangle: () => React.createElement("span", null, "alert"),
  RefreshCw: () => React.createElement("span", null, "refresh"),
  ZoomIn: () => React.createElement("span", null, "zoom-in"),
  ZoomOut: () => React.createElement("span", null, "zoom-out"),
  X: () => React.createElement("span", null, "close"),
  RotateCcw: () => React.createElement("span", null, "rotate"),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockCreateObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}`);
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

const { KycComparisonViewer } = await import("@/components/admin/kyc-comparison-viewer");

describe("KycComparisonViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the newest artifact first when duplicate step types exist", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            artifacts: [
              {
                id: "id-older",
                step_type: "id_doc",
                artifact_kind: "document",
                r2_key: "kyc/id/older.bin",
                content_type: "image/jpeg",
                file_size_bytes: 1000,
                status: "pending",
                created_at: "2026-03-27T08:00:00Z",
                purge_after: null,
                sha256: null,
              },
              {
                id: "id-newer",
                step_type: "id_doc",
                artifact_kind: "document",
                r2_key: "kyc/id/newer.bin",
                content_type: "image/jpeg",
                file_size_bytes: 1100,
                status: "pending",
                created_at: "2026-03-27T09:00:00Z",
                purge_after: null,
                sha256: null,
              },
              {
                id: "selfie-1",
                step_type: "selfie",
                artifact_kind: "selfie",
                r2_key: "kyc/selfie/current.bin",
                content_type: "image/jpeg",
                file_size_bytes: 1200,
                status: "pending",
                created_at: "2026-03-27T09:05:00Z",
                purge_after: null,
                sha256: null,
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["newer"], { type: "image/jpeg" })),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["older"], { type: "image/jpeg" })),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["selfie"], { type: "image/jpeg" })),
      });

    render(
      <KycComparisonViewer isOpen userId="user-1" displayName="Test User" onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    expect(String(mockFetch.mock.calls[1][0])).toContain("/api/admin/verification/evidence");
    expect(String(mockFetch.mock.calls[2][0])).toContain("/api/admin/verification/evidence");
    expect(String(mockFetch.mock.calls[1][1]?.body)).toContain('"artifactId":"id-newer"');
    expect(String(mockFetch.mock.calls[2][1]?.body)).toContain('"artifactId":"id-older"');
    expect(screen.getAllByText("ID Document")).toHaveLength(1);
  });

  it("expands image viewport sizing on zoom in and resets to base size", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            artifacts: [
              {
                id: "id-1",
                step_type: "id_doc",
                artifact_kind: "document",
                r2_key: "kyc/id/current.bin",
                content_type: "image/jpeg",
                file_size_bytes: 1000,
                status: "pending",
                created_at: "2026-03-27T09:00:00Z",
                purge_after: null,
                sha256: null,
              },
              {
                id: "selfie-1",
                step_type: "selfie",
                artifact_kind: "selfie",
                r2_key: "kyc/selfie/current.bin",
                content_type: "image/jpeg",
                file_size_bytes: 1200,
                status: "pending",
                created_at: "2026-03-27T09:05:00Z",
                purge_after: null,
                sha256: null,
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["id"], { type: "image/jpeg" })),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["selfie"], { type: "image/jpeg" })),
      });

    render(
      <KycComparisonViewer isOpen userId="user-1" displayName="Test User" onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Zoom in ID Document")).toBeDefined();
    });

    const idViewport = screen.getByAltText("ID Document").parentElement;
    expect(idViewport).toBeDefined();
    expect(idViewport?.className).toContain("w-full");

    fireEvent.click(screen.getByLabelText("Zoom in ID Document"));

    await waitFor(() => {
      const wrapper = screen.getByAltText("ID Document").parentElement;
      expect(wrapper).toBeDefined();
      expect(wrapper?.className).toContain("w-[125%]");
    });

    fireEvent.click(screen.getByLabelText("Reset zoom ID Document"));

    await waitFor(() => {
      const wrapper = screen.getByAltText("ID Document").parentElement;
      expect(wrapper).toBeDefined();
      expect(wrapper?.className).toContain("w-full");
    });
  });
});
