import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

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
vi.mock("@/components/admin/kyc-inline-preview", () => ({
  KycInlinePreview: () => React.createElement("div", { "data-testid": "kyc-inline-preview" }),
}));
vi.mock("lucide-react", () => ({
  CheckCircle: () => React.createElement("span", null, "✓"),
  XCircle: () => React.createElement("span", null, "✗"),
  RotateCcw: () => React.createElement("span", null, "↺"),
  FileCheck: () => React.createElement("span", null, "📄"),
  User: () => React.createElement("span", null, "👤"),
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

const mockSteps = [
  {
    id: "step-1",
    user_id: "user-1",
    step_type: "id_doc",
    status: "pending",
    created_at: new Date().toISOString(),
    seller_display_name: "John Doe",
    seller_verification_status: "pending",
  },
  {
    id: "step-2",
    user_id: "user-2",
    step_type: "selfie",
    status: "pending",
    created_at: new Date().toISOString(),
    seller_display_name: null,
    seller_verification_status: "pending",
  },
];

describe("KycQueueTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("renders empty state when no steps", () => {
    render(React.createElement(KycQueueTable, { steps: [] }));
    expect(screen.getByText(/no pending/i)).toBeInTheDocument();
  });

  it("renders step cards for each pending step", () => {
    render(React.createElement(KycQueueTable, { steps: mockSteps }));
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(2);
  });

  it("shows truncated user_id when no display name", () => {
    render(React.createElement(KycQueueTable, { steps: mockSteps }));
    expect(screen.getByText(/user-2/)).toBeInTheDocument();
  });

  it("opens approve dialog on approve click", async () => {
    render(React.createElement(KycQueueTable, { steps: mockSteps }));
    const approveButtons = screen.getAllByTitle("Approve");
    fireEvent.click(approveButtons[0]);
    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      expect(screen.getByText(/approve verification/i)).toBeInTheDocument();
    });
  });

  it("opens reject dialog on reject click", async () => {
    render(React.createElement(KycQueueTable, { steps: mockSteps }));
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
        steps: mockSteps,
        evidenceDeskEnabled: true,
      })
    );
    const evidenceLinks = screen.getAllByTitle("View Evidence");
    expect(evidenceLinks.length).toBeGreaterThan(0);
  });

  it("hides evidence link when evidenceDeskEnabled is false", () => {
    render(React.createElement(KycQueueTable, { steps: mockSteps }));
    expect(screen.queryAllByTitle("View Evidence")).toHaveLength(0);
  });
});
