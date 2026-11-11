/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  ID_ARTIFACT,
  MEMBER,
  OTHER_STAFF,
  REVIEW_SCOPE,
  SELFIE_ARTIFACT,
  STAFF_ACTOR,
  SUBJECT_LABEL,
  identityMetadata,
  staffEvidenceBytes,
  staffJson,
} from "@/test/foundation-identity-review";

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
  ScanFace: () => React.createElement("span", null, "scan-face"),
  ShieldCheck: () => React.createElement("span", null, "shield-check"),
}));

const mockFetch = vi.fn();
const { getNativeUser } = vi.hoisted(() => ({ getNativeUser: vi.fn() }));
vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: () => ({ auth: { getUser: getNativeUser } }),
}));
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

const METADATA_PATH = "/api/admin/verification/evidence/metadata";
const EVIDENCE_PATH = "/api/admin/verification/evidence";
const signedIn = (id: string) => ({ data: { user: { id } }, error: null });

type Metadata = ReturnType<typeof identityMetadata>;
/**
 * Answers the viewer's requests as the foundation routes do: the metadata of
 * one claimed ID and selfie, and each artifact's decrypted bytes, all stamped
 * with the served staff account.
 */
function serveFoundation({
  metadata = identityMetadata(),
  metadataActor = STAFF_ACTOR as string | null,
  bytes = {
    [ID_ARTIFACT]: ["synthetic id", "image/jpeg"],
    [SELFIE_ARTIFACT]: ["synthetic selfie", "image/png"],
  } as Record<string, [string, string]>,
}: {
  metadata?: Metadata;
  metadataActor?: string | null;
  bytes?: Record<string, [string, string]>;
} = {}) {
  mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (url === METADATA_PATH) return staffJson(metadata, { actor: metadataActor });
    if (url === EVIDENCE_PATH) {
      const [body, type] = bytes[JSON.parse(String(init.body)).artifactId];
      return staffEvidenceBytes(body, type);
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}
const evidenceRequests = () =>
  mockFetch.mock.calls
    .filter(([url]) => url === EVIDENCE_PATH)
    .map(([, init]) => JSON.parse(String(init.body)));

function renderViewer(props: Partial<React.ComponentProps<typeof KycComparisonViewer>> = {}) {
  return render(
    <KycComparisonViewer
      isOpen
      userId={MEMBER}
      displayName="Fixture Member"
      onClose={vi.fn()}
      {...props}
    />
  );
}
const checkAllReviewChecks = () =>
  screen.getAllByRole("checkbox").forEach((checkbox) => fireEvent.click(checkbox));

describe("KycComparisonViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fully reset the fetch mock queue so mockResolvedValueOnce chains from a
    // previous test cannot leak into the next one.
    mockFetch.mockReset();
    getNativeUser.mockResolvedValue(signedIn(STAFF_ACTOR));
  });

  it("renders an inspected native PDF and sends the viewed scope only after all review checks", async () => {
    serveFoundation({
      bytes: {
        [ID_ARTIFACT]: ["%PDF-1.4\n", "application/pdf"],
        [SELFIE_ARTIFACT]: ["synthetic image", "image/png"],
      },
    });
    const review = vi.fn();
    renderViewer({ onReviewStep: review, reviewableSteps: ["id_doc", "selfie"] });
    await waitFor(() => expect(screen.getByTitle("ID Document").tagName).toBe("IFRAME"));
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(2);
    expect(screen.getByAltText("Selfie")).toBeInTheDocument();
    expect(screen.getByText(`Identity Comparison: ${SUBJECT_LABEL}`)).toBeInTheDocument();
    expect(
      screen.getByText(/The ID number and legal name match the submitted details shown above/)
    ).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "Approve ID" });
    expect(approve).toBeDisabled();
    checkAllReviewChecks();
    expect(
      screen.getAllByRole("checkbox").map((checkbox) => (checkbox as HTMLInputElement).checked)
    ).toEqual([true, true, true]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve ID" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Approve ID" }));
    expect(review).toHaveBeenCalledExactlyOnceWith("id_doc", "approved", {
      artifactId: ID_ARTIFACT,
      foundation: REVIEW_SCOPE,
      review_subject_label: SUBJECT_LABEL,
      review_risk_score: 10,
      review_risk_level: "low",
    });
    expect(mockFetch.mock.calls[0][0]).toBe(METADATA_PATH);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ userId: MEMBER });
    expect(evidenceRequests()).toEqual([
      { artifactId: ID_ARTIFACT, foundation: REVIEW_SCOPE },
      { artifactId: SELFIE_ARTIFACT, foundation: REVIEW_SCOPE },
    ]);
  });

  it("requires all review checks before approving a specific document", async () => {
    serveFoundation();
    const review = vi.fn();
    renderViewer({ onReviewStep: review, reviewableSteps: ["id_doc", "selfie"] });
    await screen.findByAltText("Selfie");
    const approve = screen.getByRole("button", { name: "Approve selfie" });
    expect(approve).toBeDisabled();
    checkAllReviewChecks();
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(review).toHaveBeenCalledWith(
      "selfie",
      "approved",
      expect.objectContaining({ artifactId: SELFIE_ARTIFACT, foundation: REVIEW_SCOPE })
    );
  });

  it("sends rejections and retake requests with the artifact's review scope", async () => {
    serveFoundation({ metadata: identityMetadata(85) });
    const review = vi.fn();
    renderViewer({ onReviewStep: review, reviewableSteps: ["id_doc", "selfie"] });
    await screen.findByAltText("Selfie");
    const [rejectId] = screen.getAllByRole("button", { name: "Reject" });
    fireEvent.click(rejectId);
    fireEvent.click(screen.getAllByRole("button", { name: "Request retake" })[1]);
    expect(review.mock.calls).toEqual([
      [
        "id_doc",
        "rejected",
        {
          artifactId: ID_ARTIFACT,
          foundation: REVIEW_SCOPE,
          review_subject_label: SUBJECT_LABEL,
          review_risk_score: 85,
          review_risk_level: "high",
        },
      ],
      [
        "selfie",
        "needs_resubmission",
        expect.objectContaining({ artifactId: SELFIE_ARTIFACT, foundation: REVIEW_SCOPE }),
      ],
    ]);
  });

  it("refuses a decision on evidence that carries no claimed review scope", async () => {
    const metadata = identityMetadata();
    metadata.artifacts = metadata.artifacts.map(({ foundation: _scope, ...artifact }) => ({
      ...artifact,
    })) as Metadata["artifacts"];
    serveFoundation({ metadata });
    const review = vi.fn();
    renderViewer({ onReviewStep: review, reviewableSteps: ["id_doc", "selfie"] });
    await screen.findByText("Identity Comparison: Fixture Member · ID 8001015009087");
    // Both panels settle on an error instead of a preview.
    await waitFor(() => expect(screen.queryAllByText("loading")).toHaveLength(0));
    // Without a scope the evidence itself is never requested.
    expect(evidenceRequests()).toEqual([]);
    fireEvent.click(screen.getAllByRole("button", { name: "Reject" })[0]);
    expect(
      await screen.findByText("Reload the claimed evidence before deciding it.")
    ).toBeInTheDocument();
    expect(review).not.toHaveBeenCalled();
  });

  it("refuses metadata without the served-actor receipt and loads no evidence", async () => {
    serveFoundation({ metadataActor: null });
    renderViewer();
    expect(
      await screen.findByText("Evidence authorization could not be confirmed. Reload the queue.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
    expect(evidenceRequests()).toEqual([]);
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
  });

  it("refuses evidence once another staff account is signed in", async () => {
    // The account changes after the metadata has loaded.
    getNativeUser.mockResolvedValueOnce(signedIn(STAFF_ACTOR));
    getNativeUser.mockResolvedValue(signedIn(OTHER_STAFF));
    serveFoundation();
    renderViewer({ onReviewStep: vi.fn(), reviewableSteps: ["id_doc", "selfie"] });
    const refusals = await screen.findAllByText(
      "Staff account changed. Reload this page before viewing evidence."
    );
    expect(refusals).toHaveLength(2);
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    checkAllReviewChecks();
    expect(screen.getByRole("button", { name: "Approve ID" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve selfie" })).toBeDisabled();
  });

  it("refuses bytes whose format the server did not confirm and blocks approval", async () => {
    serveFoundation({
      bytes: {
        [ID_ARTIFACT]: ["synthetic id", "application/octet-stream"],
        [SELFIE_ARTIFACT]: ["synthetic selfie", "image/png"],
      },
    });
    renderViewer({ onReviewStep: vi.fn(), reviewableSteps: ["id_doc", "selfie"] });
    expect(
      await screen.findByText("The evidence format could not be confirmed.")
    ).toBeInTheDocument();
    expect(await screen.findByAltText("Selfie")).toBeInTheDocument();
    checkAllReviewChecks();
    expect(screen.getByRole("button", { name: "Approve selfie" })).toBeDisabled();
  });

  it("downloads and re-checks the evidence again every time it is opened", async () => {
    serveFoundation();
    const { rerender } = renderViewer();
    await screen.findByAltText("Selfie");
    rerender(
      <KycComparisonViewer
        isOpen={false}
        userId={MEMBER}
        displayName="Fixture Member"
        onClose={vi.fn()}
      />
    );
    rerender(
      <KycComparisonViewer isOpen userId={MEMBER} displayName="Fixture Member" onClose={vi.fn()} />
    );
    await waitFor(() => expect(evidenceRequests()).toHaveLength(4));
    await screen.findByAltText("Selfie");
    // Two metadata reads and four evidence reads, each checked against the signed-in account.
    expect(getNativeUser).toHaveBeenCalledTimes(6);
  });

  it("shows the server's refusal of the metadata and retries on request", async () => {
    mockFetch.mockResolvedValueOnce(
      staffJson(
        {
          error: "The identity submission changed. Reload the queue.",
          reason: "staff_command_refused",
        },
        { status: 409 }
      )
    );
    renderViewer();
    expect(
      await screen.findByText("The identity submission changed. Reload the queue.")
    ).toBeInTheDocument();
    serveFoundation();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByAltText("Selfie")).toBeInTheDocument();
  });

  it("expands image viewport sizing on zoom in and resets to base size", async () => {
    serveFoundation();
    renderViewer();

    await screen.findByAltText("ID Document");

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

  it("shows a neutral 'liveness unknown' verdict and the manual-review signal", async () => {
    serveFoundation();
    renderViewer();

    await waitFor(() => {
      expect(screen.getByText(/Liveness unknown/i)).toBeDefined();
    });
    expect(screen.getByTitle("manual_review_only")).toHaveTextContent("manual review only");
    expect(screen.queryByText(/Face match/i)).not.toBeInTheDocument();
  });
});
