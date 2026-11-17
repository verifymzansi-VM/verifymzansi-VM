import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import {
  ID_ARTIFACT,
  OTHER_STAFF,
  REVIEW_SCOPE,
  SELFIE_ARTIFACT,
  STAFF_ACTOR,
  identityArtifact,
  staffEvidenceBytes,
  staffJson,
} from "@/test/foundation-identity-review";
import { EvidenceViewer } from "./evidence-viewer";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: () => ({ auth: { getUser } }),
}));

const EVIDENCE_PATH = "/api/admin/verification/evidence";
const csrfToken = "c".repeat(64);
const artifact = identityArtifact("id_doc");

type Answer = (init?: RequestInit) => Response | Promise<Response>;
/** Answers the evidence request; the CSRF bootstrap is answered only when a test provides it. */
function installFetch(evidence: Answer, csrf?: Answer) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/csrf" && csrf) return csrf(init);
    if (url === EVIDENCE_PATH) return evidence(init);
    throw new Error(`Unexpected request to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const evidenceCalls = (fetchMock: ReturnType<typeof installFetch>) =>
  fetchMock.mock.calls.filter(([url]) => url === EVIDENCE_PATH);

describe("EvidenceViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: STAFF_ACTOR } }, error: null });
    URL.createObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}`);
    URL.revokeObjectURL = vi.fn();
    document.cookie = `vm_csrf=${csrfToken}; path=/`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "vm_csrf=; Max-Age=0; path=/";
    document.querySelector('meta[name="csrf-token"]')?.remove();
  });

  describe("request protection", () => {
    beforeEach(() => {
      document.cookie = "vm_csrf=; Max-Age=0; path=/";
    });

    it("bootstraps CSRF and sends a request accepted by the real server guard", async () => {
      const fetchMock = installFetch(
        (init) => {
          const headers = new Headers(init?.headers);
          headers.set("cookie", document.cookie);
          expect(enforceCsrfToken({ headers, url: `http://localhost${EVIDENCE_PATH}` })).toBeNull();
          return staffEvidenceBytes("synthetic image", "image/png");
        },
        () => {
          document.cookie = `vm_csrf=${csrfToken}; path=/`;
          return Response.json({ token: csrfToken });
        }
      );
      render(<EvidenceViewer artifact={artifact} />);
      await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/csrf", EVIDENCE_PATH]);
    });

    it("does not request evidence when CSRF bootstrap fails", async () => {
      const fetchMock = installFetch(
        () => staffEvidenceBytes("synthetic image", "image/png"),
        () => new Response(null, { status: 503 })
      );
      render(<EvidenceViewer artifact={artifact} />);
      await screen.findByText("Security check failed. Please refresh the page and try again.");
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/csrf"]);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    });
  });

  it("requests the artifact within its claimed review scope and shows the inspected image", async () => {
    const onInspected = vi.fn();
    const fetchMock = installFetch(() => staffEvidenceBytes("synthetic image", "image/png"));
    render(<EvidenceViewer artifact={artifact} onInspected={onInspected} />);

    expect(screen.getByText("id_doc — id_front")).toBeInTheDocument();
    expect(screen.getByText("(Not yet loaded)")).toBeInTheDocument();
    const image = await screen.findByAltText("Evidence: id_doc");
    expect(image).toHaveAttribute("src", "blob:15");
    expect(screen.getByText("(15 B)")).toBeInTheDocument();

    const [[, init]] = evidenceCalls(fetchMock);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      artifactId: ID_ARTIFACT,
      foundation: REVIEW_SCOPE,
    });
    expect(onInspected).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: ID_ARTIFACT, content_type: "image/png", file_size_bytes: 15 })
    );
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("shows a PDF in a frame", async () => {
    installFetch(() => staffEvidenceBytes("%PDF-1.4\n", "application/pdf"));
    render(<EvidenceViewer artifact={artifact} />);
    expect(await screen.findByTitle("Evidence: id_doc")).toHaveProperty("tagName", "IFRAME");
  });

  it("refuses evidence served to a different staff account", async () => {
    installFetch(() => staffEvidenceBytes("synthetic image", "image/png", OTHER_STAFF));
    render(<EvidenceViewer artifact={artifact} />);
    await screen.findByText("Staff account changed. Reload this page before viewing evidence.");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByAltText("Evidence: id_doc")).not.toBeInTheDocument();
  });

  it("refuses evidence without the served-actor receipt", async () => {
    installFetch(() => staffEvidenceBytes("synthetic image", "image/png", null));
    render(<EvidenceViewer artifact={artifact} />);
    await screen.findByText("Evidence authorization could not be confirmed. Reload the queue.");
    expect(getUser).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("refuses bytes whose format the server did not confirm", async () => {
    const onInspected = vi.fn();
    installFetch(() => staffEvidenceBytes("synthetic bytes", "application/octet-stream"));
    render(<EvidenceViewer artifact={artifact} onInspected={onInspected} />);
    await screen.findByText("The evidence format could not be confirmed.");
    expect(onInspected).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and retries on request", async () => {
    const fetchMock = installFetch(() =>
      staffJson(
        { error: "Evidence is unavailable, the claim expired or permission changed" },
        { status: 409 }
      )
    );
    render(<EvidenceViewer artifact={artifact} />);
    await screen.findByText("Evidence is unavailable, the claim expired or permission changed");
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async () => staffEvidenceBytes("synthetic image", "image/png"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByAltText("Evidence: id_doc")).toBeInTheDocument();
    expect(evidenceCalls(fetchMock)).toHaveLength(2);
  });

  it("revokes the previous blob URL when another artifact is shown", async () => {
    const fetchMock = installFetch(() => staffEvidenceBytes("synthetic image", "image/png"));
    const { rerender } = render(<EvidenceViewer artifact={artifact} />);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));

    rerender(<EvidenceViewer artifact={identityArtifact("selfie")} />);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:15");
    expect(JSON.parse(String(evidenceCalls(fetchMock)[1][1]?.body))).toEqual({
      artifactId: SELFIE_ARTIFACT,
      foundation: REVIEW_SCOPE,
    });
  });
});
