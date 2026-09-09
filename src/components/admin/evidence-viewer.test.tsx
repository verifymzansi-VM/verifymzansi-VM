import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { EvidenceViewer } from "./evidence-viewer";

const csrfToken = "c".repeat(64);
const artifact = {
  id: "artifact-id",
  step_type: "id_doc",
  artifact_kind: "original",
  r2_key: "private/key",
  content_type: "image/png",
  file_size_bytes: 100,
  status: "pending",
  created_at: "2026-09-01T00:00:00Z",
  purge_after: null,
  sha256: null,
};

describe("EvidenceViewer request protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = "vm_csrf=; Max-Age=0; path=/";
    document.querySelector('meta[name="csrf-token"]')?.remove();
    URL.createObjectURL = vi.fn().mockReturnValue("blob:evidence");
    URL.revokeObjectURL = vi.fn();
  });

  it("bootstraps CSRF and sends a request accepted by the real server guard", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/csrf") {
        document.cookie = `vm_csrf=${csrfToken}; path=/`;
        return { ok: true, json: async () => ({ token: csrfToken }) };
      }
      const headers = new Headers(init?.headers);
      headers.set("cookie", document.cookie);
      expect(enforceCsrfToken({ headers, url: `http://localhost${url}` })).toBeNull();
      return { ok: true, blob: async () => new Blob(["evidence"]) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<EvidenceViewer artifact={artifact} />);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/admin/verification/evidence");
  });

  it("does not request evidence when CSRF bootstrap fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    render(<EvidenceViewer artifact={artifact} />);
    await screen.findByText("Security check failed. Please refresh the page and try again.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/csrf");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
});
