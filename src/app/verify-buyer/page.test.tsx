import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VerifyBuyerPage from "./page";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { useToast } from "@/hooks/use-toast";

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer data-testid="footer" />,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

describe("VerifyBuyerPage", () => {
  const mockToast = vi.fn();
  const validToken = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = `vm_csrf=${"b".repeat(64)}; path=/`;
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      toast: mockToast,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: "valid",
        buyerInfo: {
          displayName: "S",
          verifiedAt: "2026-02-20T10:00:00.000Z",
        },
      }),
    }) as unknown as typeof fetch;
  });

  it("renders the page title", () => {
    render(<VerifyBuyerPage />);
    expect(screen.getByRole("heading", { name: "Verify a Buyer" })).toBeInTheDocument();
  });

  it("shows valid result state", async () => {
    render(<VerifyBuyerPage />);

    fireEvent.change(screen.getByLabelText("Buyer Token"), {
      target: { value: validToken },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify buyer token/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/verify-buyer",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    expect(await screen.findByText("Verified Buyer")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("shows expired state", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: "expired" }),
    });

    render(<VerifyBuyerPage />);

    fireEvent.change(screen.getByLabelText("Buyer Token"), {
      target: { value: validToken },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify buyer token/i }));

    expect(await screen.findByText("Token expired")).toBeInTheDocument();
  });

  it("shows validation toast and skips fetch for invalid UUID", () => {
    render(<VerifyBuyerPage />);

    fireEvent.change(screen.getByLabelText("Buyer Token"), {
      target: { value: "invalid-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify buyer token/i }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Enter a valid token",
        variant: "destructive",
      })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

const mockToast = vi.fn();
const csrfToken = "b".repeat(64);
function submitToken() {
  fireEvent.change(screen.getByLabelText("Buyer Token"), {
    target: { value: "12345678-1234-4123-8123-123456789012" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify buyer token" }));
}

describe("buyer token verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useToast).mockReturnValue({ toast: mockToast, dismiss: vi.fn(), toasts: [] });
    document.cookie = "vm_csrf=; Max-Age=0; path=/";
    document.querySelector('meta[name="csrf-token"]')?.remove();
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
      return { ok: true, json: async () => ({ result: "not_found" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VerifyBuyerPage />);
    submitToken();
    await screen.findByText("Invalid token. Ask the buyer to share their current token.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/verify-buyer");
  });

  it("does not submit a buyer token when CSRF bootstrap fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    render(<VerifyBuyerPage />);
    submitToken();
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/csrf");
    expect(screen.getByRole("button", { name: "Verify buyer token" })).toBeEnabled();
  });
});
