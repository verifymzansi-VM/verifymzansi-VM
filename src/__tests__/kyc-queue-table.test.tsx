import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const mockToast = vi.fn();

// Mock UI components
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ..._ }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", { "data-testid": "card", className }, children),
  CardContent: ({ children, className, ..._ }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", { className }, children),
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    variant: _variant,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("span", props, children),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    variant: _variant,
    size: _size,
    asChild: _asChild,
    ...props
  }: React.PropsWithChildren<{
    onClick?: () => void;
    variant?: string;
    size?: string;
    asChild?: boolean;
  }>) => React.createElement("button", { onClick, ...props }, children),
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
  DialogFooter: ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children),
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ ...props }: Record<string, unknown>) => {
    const { className, ...domProps } = props;
    return React.createElement("textarea", { className, ...domProps });
  },
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: React.PropsWithChildren) =>
    React.createElement("label", props, children),
}));
vi.mock("@/lib/utils/format", () => ({
  formatRelativeTime: vi.fn(() => "2 hours ago"),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: React.PropsWithChildren<{ href: string }>) =>
    React.createElement("a", { href }, children),
}));
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    let Component: React.ComponentType<Record<string, unknown>> | null = null;

    const DynamicComponent = (props: Record<string, unknown>) => {
      const [Resolved, setResolved] = React.useState<React.ComponentType<
        Record<string, unknown>
      > | null>(() => Component);

      React.useEffect(() => {
        if (Resolved) return;

        let mounted = true;
        loader().then((mod: unknown) => {
          const loaded = mod as { default?: React.ComponentType<Record<string, unknown>> };
          Component = loaded.default || (loaded as React.ComponentType<Record<string, unknown>>);
          if (mounted) {
            setResolved(() => Component);
          }
        });

        return () => {
          mounted = false;
        };
      }, [Resolved]);

      return Resolved ? React.createElement(Resolved, props) : null;
    };

    return DynamicComponent;
  },
}));
vi.mock("@/components/admin/kyc-inline-preview", () => ({
  KycInlinePreview: () => React.createElement("div", { "data-testid": "kyc-inline-preview" }),
}));
vi.mock("@/components/admin/kyc-comparison-viewer", () => ({
  KycComparisonViewer: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? React.createElement("div", { "data-testid": "comparison-viewer" }) : null,
}));
vi.mock("@/components/admin/kyc-preview-lightbox", () => ({
  KycPreviewLightbox: ({
    open,
    step,
    artifact,
  }: {
    open: boolean;
    step: { id: string };
    artifact: { id: string };
  }) =>
    open
      ? React.createElement(
          "div",
          {
            "data-testid": "kyc-preview-lightbox",
            "data-step-id": step.id,
            "data-artifact-id": artifact.id,
          },
          "Preview Lightbox"
        )
      : null,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));
vi.mock("lucide-react", () => ({
  CheckCircle: () => React.createElement("span", null, "✓"),
  XCircle: () => React.createElement("span", null, "✗"),
  RotateCcw: () => React.createElement("span", null, "↺"),
  FileCheck: () => React.createElement("span", null, "📄"),
  Phone: () => React.createElement("span", null, "📞"),
  Camera: () => React.createElement("span", null, "📷"),
  MapPin: () => React.createElement("span", null, "📍"),
  CreditCard: () => React.createElement("span", null, "💳"),
  Loader2: () => React.createElement("span", null, "⏳"),
  Eye: () => React.createElement("span", null, "👁"),
  ImageIcon: () => React.createElement("span", null, "🖼"),
  FileText: () => React.createElement("span", null, "📃"),
  AlertTriangle: () => React.createElement("span", null, "⚠"),
  RefreshCw: () => React.createElement("span", null, "🔄"),
  ExternalLink: () => React.createElement("span", null, "🔗"),
  ZoomIn: () => React.createElement("span", null, "🔍"),
  ZoomOut: () => React.createElement("span", null, "🔎"),
}));

import { KycQueueTable } from "@/components/admin/kyc-queue-table";

const now = new Date().toISOString();
const groupedItems = [
  {
    user_id: "user-1",
    account_display_name: "John Doe",
    account_verification_status: "pending_review",
    latest_created_at: now,
    pending_step_count: 2,
    primary_step_id: "step-1",
    primary_step_type: "id_doc",
    steps: [
      {
        id: "step-1",
        user_id: "user-1",
        step_type: "id_doc",
        status: "pending",
        created_at: now,
        reviewed_at: null,
        risk_level: null,
        risk_score: null,
        auto_status: null,
        account_display_name: "John Doe",
        account_verification_status: "pending_review",
      },
      {
        id: "step-2",
        user_id: "user-1",
        step_type: "selfie",
        status: "pending",
        created_at: now,
        reviewed_at: null,
        risk_level: null,
        risk_score: null,
        auto_status: null,
        account_display_name: "John Doe",
        account_verification_status: "pending_review",
      },
    ],
  },
  {
    user_id: "user-2",
    account_display_name: "New Member",
    account_verification_status: "pending_review",
    latest_created_at: now,
    pending_step_count: 1,
    primary_step_id: "step-3",
    primary_step_type: "location",
    steps: [
      {
        id: "step-3",
        user_id: "user-2",
        step_type: "location",
        status: "pending",
        created_at: now,
        reviewed_at: null,
        risk_level: null,
        risk_score: null,
        auto_status: null,
        account_display_name: "New Member",
        account_verification_status: "pending_review",
      },
    ],
  },
];

describe("KycQueueTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("renders empty state when no steps", () => {
    render(React.createElement(KycQueueTable, { groups: [] }));
    expect(screen.getByText(/no pending/i)).toBeInTheDocument();
  });

  it("renders one card per user group", () => {
    render(React.createElement(KycQueueTable, { groups: groupedItems }));
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("New Member")).toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(2);
  });

  it("renders all grouped document chips under one user", () => {
    render(React.createElement(KycQueueTable, { groups: groupedItems }));
    expect(screen.getAllByText("ID Document").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Selfie Verification").length).toBeGreaterThan(0);
  });

  it("opens approve dialog on approve click", async () => {
    render(React.createElement(KycQueueTable, { groups: groupedItems }));
    const approveButtons = screen.getAllByTitle("Approve");
    fireEvent.click(approveButtons[0]);
    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      expect(screen.getByText(/approve verification/i)).toBeInTheDocument();
    });
  });

  it("opens reject dialog on reject click", async () => {
    render(React.createElement(KycQueueTable, { groups: groupedItems }));
    const rejectButtons = screen.getAllByTitle("Reject");
    fireEvent.click(rejectButtons[0]);
    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      expect(screen.getByText(/reject verification/i)).toBeInTheDocument();
    });
  });

  it("shows evidence link when evidenceDeskEnabled", () => {
    render(
      React.createElement(KycQueueTable, {
        groups: groupedItems,
        evidenceDeskEnabled: true,
      })
    );
    const evidenceLinks = screen.getAllByTitle("View Evidence");
    expect(evidenceLinks.length).toBeGreaterThan(0);
    const links = screen.getAllByRole("link", { name: /evidence/i });
    expect(links[0]).toHaveAttribute("href", "/admin/verification/evidence");
    expect(links[1]).toHaveAttribute("href", "/admin/verification/evidence");
  });

  it("hides evidence link when evidenceDeskEnabled is false", () => {
    render(React.createElement(KycQueueTable, { groups: groupedItems }));
    expect(screen.queryAllByTitle("View Evidence")).toHaveLength(0);
  });

  it("opens side-by-side comparison from the group-level view docs button", async () => {
    render(React.createElement(KycQueueTable, { groups: groupedItems }));

    fireEvent.click(screen.getAllByTitle("Compare ID and selfie")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("comparison-viewer")).toBeInTheDocument();
    });
  });

  it("opens a row-level document preview for the selected step", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        artifacts: [
          {
            id: "artifact-older",
            step_type: "id_doc",
            artifact_kind: "front",
            r2_key: "older",
            content_type: "image/jpeg",
            file_size_bytes: 100,
            status: "ready",
            created_at: "2026-03-26T08:00:00.000Z",
            purge_after: null,
            sha256: null,
          },
          {
            id: "artifact-newest",
            step_type: "id_doc",
            artifact_kind: "front",
            r2_key: "newest",
            content_type: "image/jpeg",
            file_size_bytes: 120,
            status: "ready",
            created_at: "2026-03-27T08:00:00.000Z",
            purge_after: null,
            sha256: null,
          },
        ],
      }),
    } as Response);

    render(React.createElement(KycQueueTable, { groups: groupedItems }));

    fireEvent.click(screen.getAllByTitle("View")[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const [requestUrl, requestInit] = vi.mocked(global.fetch).mock.calls[0] ?? [];

    expect(requestUrl).toBe("/api/admin/verification/evidence/metadata");
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers as HeadersInit).get("Content-Type")).toBe(
      "application/json"
    );
    expect(requestInit?.body).toBe(JSON.stringify({ stepId: "step-1", userId: "user-1" }));

    await waitFor(() => {
      expect(screen.getByTestId("kyc-preview-lightbox")).toHaveAttribute(
        "data-artifact-id",
        "artifact-newest"
      );
    });
  });

  it("shows a destructive toast when no artifact matches the selected step", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        artifacts: [],
      }),
    } as Response);

    render(React.createElement(KycQueueTable, { groups: groupedItems }));

    fireEvent.click(screen.getAllByTitle("View")[0]);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Unable to open evidence",
          description: "No document uploaded",
          variant: "destructive",
        })
      );
    });

    expect(screen.queryByTestId("kyc-preview-lightbox")).not.toBeInTheDocument();
  });

  it("disables only the clicked view button while metadata is loading", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.mocked(global.fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    render(React.createElement(KycQueueTable, { groups: groupedItems }));

    const viewButtons = screen.getAllByTitle("View");
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(viewButtons[0]).toBeDisabled();
      expect(viewButtons[1]).not.toBeDisabled();
    });

    resolveFetch({
      ok: true,
      json: async () => ({
        artifacts: [
          {
            id: "artifact-selfie",
            step_type: "id_doc",
            artifact_kind: "front",
            r2_key: "artifact-selfie",
            content_type: "image/jpeg",
            file_size_bytes: 200,
            status: "ready",
            created_at: "2026-03-27T08:00:00.000Z",
            purge_after: null,
            sha256: null,
          },
        ],
      }),
    } as Response);

    await waitFor(() => {
      expect(viewButtons[0]).not.toBeDisabled();
    });
  });
});
