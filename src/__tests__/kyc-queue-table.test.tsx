import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const mockToast = vi.fn();
// The signed-in staff account that evidence responses must have been served to.
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: () => ({ auth: { getUser } }),
}));

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
vi.mock("@/lib/utils/format", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
// The viewer's own tests cover loading and checking the evidence; here it only
// hands back a decision for the evidence it showed, as it does on foundation.
const viewer = vi.hoisted(() => ({ riskScore: 10 }));
vi.mock("@/components/admin/kyc-comparison-viewer", () => ({
  KycComparisonViewer: ({
    isOpen,
    onReviewStep,
  }: {
    isOpen: boolean;
    onReviewStep?: (
      stepType: "id_doc" | "selfie",
      decision: "approved" | "rejected" | "needs_resubmission",
      review: Record<string, unknown>
    ) => void;
  }) => {
    if (!isOpen) return null;
    const decide = (stepType: "id_doc" | "selfie", decision: "approved" | "rejected") => {
      const artifact = identityArtifact(stepType, viewer.riskScore);
      onReviewStep?.(stepType, decision, {
        artifactId: artifact.id,
        foundation: artifact.foundation,
        review_subject_label: artifact.review_subject_label,
        review_risk_score: artifact.review_risk_score,
        review_risk_level: artifact.review_risk_level,
      });
    };
    return React.createElement(
      "div",
      { "data-testid": "comparison-viewer" },
      React.createElement("button", { onClick: () => decide("id_doc", "approved") }, "Approve ID"),
      React.createElement(
        "button",
        { onClick: () => decide("selfie", "rejected") },
        "Reject selfie"
      )
    );
  },
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
import { QueueClaimsProvider } from "@/components/admin/queue-claims";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import { readFrontendStaffVerificationQueue } from "@/lib/foundation/staff-verification-queue";
import { adminVerificationDecideSchema } from "@/lib/validations/admin";
import { nativeIdentityScopeSchema } from "@/lib/admin/native-identity-review";
import { z } from "zod";
import {
  ID_ARTIFACT,
  MEMBER,
  REVIEW_SCOPE,
  SELFIE_ARTIFACT,
  STAFF_ACTOR,
  STEP_UPDATED_AT,
  SUBJECT_LABEL,
  UPLOADED_AT,
  fixtureUuid,
  identityArtifact,
  identityMetadata,
  staffJson,
} from "@/test/foundation-identity-review";

/** The input the foundation decide route accepts (restored-identity-decision-route.ts). */
const restoredDecisionInput = adminVerificationDecideSchema
  .safeExtend({ foundation: nativeIdentityScopeSchema, stepMatches: z.boolean().optional() })
  .strict();

const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const queueStep = (id: string, step_type: "id_doc" | "selfie") => ({
  id,
  step_type,
  created_at: UPLOADED_AT,
  updated_at: STEP_UPDATED_AT,
  reviewed_at: null,
  risk_score: 10,
  risk_level: "low",
  auto_status: "manual_review",
});
const SECOND_CASE = fixtureUuid(11);
const SECOND_MEMBER = fixtureUuid(810);
const SECOND_ID = fixtureUuid(14);

/**
 * The queue as the foundation queue read projects it: the reviewer has
 * claimed the first member's check (so it carries its review scope); a
 * colleague holds the second.
 */
const { groups: groupedItems } = await readFrontendStaffVerificationQueue(
  {
    rpc: async () => ({
      error: null,
      data: {
        account_id: STAFF_ACTOR,
        total_steps: 3,
        groups: [
          {
            case_id: REVIEW_SCOPE.caseId,
            owner_id: MEMBER,
            version: REVIEW_SCOPE.caseVersion,
            display_name: "John Doe",
            created_at: now,
            steps: [queueStep(ID_ARTIFACT, "id_doc"), queueStep(SELFIE_ARTIFACT, "selfie")],
            review_scope: REVIEW_SCOPE,
          },
          {
            case_id: SECOND_CASE,
            owner_id: SECOND_MEMBER,
            version: 1,
            display_name: "New Member",
            created_at: now,
            steps: [queueStep(SECOND_ID, "id_doc")],
            review_scope: null,
          },
        ],
      },
    }),
  } as unknown as FoundationAuthenticatedApi,
  STAFF_ACTOR
);
const expiresAt = "2026-11-11T12:00:00Z";
const claims = {
  [`verification_step:${REVIEW_SCOPE.caseId}`]: { mine: true, holderName: "You", expiresAt },
  [`verification_step:${SECOND_CASE}`]: { mine: false, holderName: "Thandi", expiresAt },
};

function renderQueue(
  props: Partial<React.ComponentProps<typeof KycQueueTable>> = {},
  claimed: typeof claims | Record<string, never> = claims
) {
  return render(
    <QueueClaimsProvider claims={claimed} mustClaim={false} canFree={false}>
      <KycQueueTable groups={groupedItems} {...props} />
    </QueueClaimsProvider>
  );
}
const fetchMock = () => vi.mocked(global.fetch);
function decideBody() {
  const [url, init] = fetchMock().mock.calls[0] ?? [];
  expect(url).toBe("/api/admin/verification/decide");
  return JSON.parse(String(init?.body));
}

describe("KycQueueTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    getUser.mockResolvedValue({ data: { user: { id: STAFF_ACTOR } }, error: null });
    viewer.riskScore = 10;
  });

  it("renders empty state when no steps", () => {
    renderQueue({ groups: [] });
    expect(screen.getByText(/no pending/i)).toBeInTheDocument();
  });

  it("renders one card per user group", () => {
    renderQueue();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("New Member")).toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(2);
  });

  it("renders all grouped document chips under one user", () => {
    renderQueue();
    expect(screen.getAllByText("ID Document").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Selfie Verification").length).toBeGreaterThan(0);
  });

  it("opens comparison before allowing an identity approval", async () => {
    renderQueue();
    const approveButtons = screen.getAllByTitle("Review evidence");
    fireEvent.click(approveButtons[0]);
    await waitFor(() => {
      expect(screen.getByTestId("comparison-viewer")).toBeInTheDocument();
      expect(screen.queryByText(/approve verification/i)).not.toBeInTheDocument();
    });
  });

  it("opens reject dialog on reject click", async () => {
    renderQueue();
    const rejectButtons = screen.getAllByTitle("Reject");
    fireEvent.click(rejectButtons[0]);
    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      expect(screen.getByText(/reject verification/i)).toBeInTheDocument();
    });
  });

  it("lets the reviewer decide only the checks they have claimed", () => {
    renderQueue();
    // One claim covers both steps of a member's check.
    expect(screen.getAllByText("Claimed by you")).toHaveLength(2);
    expect(screen.getByText("Claimed by Thandi")).toBeInTheDocument();
    expect(screen.getByText("Thandi is working on this")).toBeInTheDocument();
    const decisions = ["Review evidence", "Reject", "Resubmit"].map((title) =>
      screen.getAllByTitle(title)
    );
    // Rows 1 and 2 are the claimed ID and selfie; row 3 is the colleague's ID.
    for (const buttons of decisions) {
      expect(buttons.map((button) => (button as HTMLButtonElement).disabled)).toEqual([
        false,
        false,
        true,
      ]);
    }
  });

  it("blocks every decision while nothing is claimed, even for governors", () => {
    renderQueue({}, {});
    expect(screen.getAllByText("Claim items from the queue to decide them")).toHaveLength(3);
    for (const title of ["Review evidence", "Reject", "Resubmit"])
      for (const button of screen.getAllByTitle(title)) expect(button).toBeDisabled();
  });

  it("approves from the comparison with the viewed scope and an identity match", async () => {
    fetchMock().mockResolvedValue(staffJson({ success: true, status: "step_approved" }));
    const onDecisionComplete = vi.fn();
    renderQueue({ onDecisionComplete });
    fireEvent.click(screen.getAllByTitle("Compare ID and selfie")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve ID" }));

    expect(screen.queryByTestId("comparison-viewer")).not.toBeInTheDocument();
    expect(screen.getByText("Approve Verification Step")).toBeInTheDocument();
    expect(
      screen.getByText(
        `Confirm that the ID number and name match the submitted details: ${SUBJECT_LABEL} Both step approvals are required; high-risk submissions need an independent second reviewer.`
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Confirm Approve/ }));

    await waitFor(() => expect(onDecisionComplete).toHaveBeenCalled());
    const body = decideBody();
    expect(body).toEqual({
      stepId: ID_ARTIFACT,
      expectedUpdatedAt: STEP_UPDATED_AT,
      decision: "approved",
      foundation: REVIEW_SCOPE,
      stepMatches: true,
    });
    expect(restoredDecisionInput.safeParse(body).success).toBe(true);
  });

  it("requires an override reason for a high-risk identity the viewer reported", async () => {
    viewer.riskScore = 85;
    fetchMock().mockResolvedValue(
      staffJson({ success: true, status: "awaiting_second_reviewer", overrideProposed: true })
    );
    renderQueue();
    fireEvent.click(screen.getAllByTitle("Compare ID and selfie")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve ID" }));
    expect(screen.getByText(/This step has/)).toHaveTextContent("high risk");

    fireEvent.click(screen.getByRole("button", { name: /Confirm Approve/ }));
    expect(
      await screen.findByText("Override reason code is required when approving high-risk steps.")
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTitle("Override reason code"), {
      target: { value: "supporting_evidence" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm Approve/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = decideBody();
    expect(body).toMatchObject({
      stepId: ID_ARTIFACT,
      decision: "approved",
      foundation: REVIEW_SCOPE,
      stepMatches: true,
      overrideReasonCode: "supporting_evidence",
    });
    expect(restoredDecisionInput.safeParse(body).success).toBe(true);
  });

  it("sends a row rejection with the claimed scope and no identity match", async () => {
    fetchMock().mockResolvedValue(
      staffJson({ success: true, status: "rejected", version: REVIEW_SCOPE.caseVersion + 1 })
    );
    const onDecisionComplete = vi.fn();
    renderQueue({ onDecisionComplete });
    fireEvent.click(screen.getAllByTitle("Reject")[1]);
    fireEvent.change(screen.getByTitle("Reason code"), { target: { value: "mismatch" } });
    fireEvent.change(screen.getByLabelText(/Note to the member/), {
      target: { value: "The selfie does not match the ID portrait." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm Reject/ }));

    await waitFor(() => expect(onDecisionComplete).toHaveBeenCalled());
    const body = decideBody();
    expect(body).toEqual({
      stepId: SELFIE_ARTIFACT,
      expectedUpdatedAt: STEP_UPDATED_AT,
      decision: "rejected",
      reasonCode: "mismatch",
      reasonNote: "The selfie does not match the ID portrait.",
      foundation: REVIEW_SCOPE,
    });
    expect(restoredDecisionInput.safeParse(body).success).toBe(true);
  });

  // The decide route requires a written explanation for every rejection or
  // retake request (adminVerificationDecideSchema), so the dialog asks for it
  // before sending instead of letting the server refuse an empty note.
  it("asks for a note to the member before sending a rejection", async () => {
    fetchMock().mockResolvedValue(staffJson({ success: true }));
    renderQueue();
    fireEvent.click(screen.getAllByTitle("Reject")[0]);
    fireEvent.change(screen.getByTitle("Reason code"), { target: { value: "blurry_image" } });
    fireEvent.change(screen.getByLabelText(/Note to the member/), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm Reject/ }));
    expect(
      await screen.findByText("Please write a note telling the member what to fix.")
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Note to the member/), {
      target: { value: "Please retake the photo without glare." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm Reject/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(restoredDecisionInput.safeParse(decideBody()).success).toBe(true);
  });

  it("shows evidence link when evidenceDeskEnabled", () => {
    renderQueue({ evidenceDeskEnabled: true });
    const evidenceLinks = screen.getAllByTitle("View evidence");
    expect(evidenceLinks.length).toBeGreaterThan(0);
    const links = screen.getAllByRole("link", { name: /evidence/i });
    expect(links[0]).toHaveAttribute("href", "/admin/verification/evidence");
    expect(links[1]).toHaveAttribute("href", "/admin/verification/evidence");
  });

  it("hides evidence link when evidenceDeskEnabled is false", () => {
    renderQueue();
    expect(screen.queryAllByTitle("View evidence")).toHaveLength(0);
  });

  it("opens side-by-side comparison from the group-level view docs button", async () => {
    renderQueue();

    fireEvent.click(screen.getAllByTitle("Compare ID and selfie")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("comparison-viewer")).toBeInTheDocument();
    });
  });

  it("opens a row-level document preview for the selected step", async () => {
    fetchMock().mockResolvedValueOnce(staffJson(identityMetadata()));

    renderQueue();

    fireEvent.click(screen.getAllByTitle("View")[1]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const [requestUrl, requestInit] = fetchMock().mock.calls[0] ?? [];

    expect(requestUrl).toBe("/api/admin/verification/evidence/metadata");
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers as HeadersInit).get("Content-Type")).toBe(
      "application/json"
    );
    expect(requestInit?.body).toBe(JSON.stringify({ stepId: SELFIE_ARTIFACT, userId: MEMBER }));

    await waitFor(() => {
      expect(screen.getByTestId("kyc-preview-lightbox")).toHaveAttribute(
        "data-artifact-id",
        SELFIE_ARTIFACT
      );
    });
    expect(screen.getByTestId("kyc-preview-lightbox")).toHaveAttribute(
      "data-step-id",
      SELFIE_ARTIFACT
    );
  });

  it.each([
    {
      case: "the server refuses the metadata",
      response: () =>
        staffJson(
          {
            error: "The identity submission changed. Reload the queue.",
            reason: "staff_command_refused",
          },
          { status: 409 }
        ),
      description: "The identity submission changed. Reload the queue.",
    },
    {
      case: "the metadata lacks the served-actor receipt",
      response: () => staffJson(identityMetadata(), { actor: null }),
      description: "Evidence authorization could not be confirmed. Reload the queue.",
    },
  ])("shows a destructive toast when $case", async ({ response, description }) => {
    fetchMock().mockResolvedValueOnce(response());

    renderQueue();

    fireEvent.click(screen.getAllByTitle("View")[0]);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Unable to open evidence",
          description,
          variant: "destructive",
        })
      );
    });

    expect(screen.queryByTestId("kyc-preview-lightbox")).not.toBeInTheDocument();
  });

  it("disables only the clicked view button while metadata is loading", async () => {
    let resolveFetch!: (value: Response) => void;
    fetchMock().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    renderQueue();

    const viewButtons = screen.getAllByTitle("View");
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(viewButtons[0]).toBeDisabled();
      expect(viewButtons[1]).not.toBeDisabled();
    });

    resolveFetch(staffJson(identityMetadata()));

    await waitFor(() => {
      expect(viewButtons[0]).not.toBeDisabled();
    });
  });
});
