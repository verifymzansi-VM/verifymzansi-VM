import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DsarPage from "./page";
import { enforceCsrfToken } from "@/lib/utils/csrf";

const mockToast = vi.fn();
const mockRouterPush = vi.fn();
const csrfToken = "a".repeat(64);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));
vi.mock("@/components/layout/header", () => ({ Header: () => <div>Header</div> }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => <div>Footer</div> }));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));
vi.mock("@/components/ui/turnstile-widget", () => ({
  TurnstileWidget: ({
    onSuccess,
    retryToken = 0,
  }: {
    onSuccess: (token: string) => void;
    retryToken?: number;
  }) => (
    <button type="button" onClick={() => onSuccess(`turnstile-token-${retryToken}`)}>
      Complete captcha
    </button>
  ),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("DSAR page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = `vm_csrf=${csrfToken}; path=/`;
    document.querySelector('meta[name="csrf-token"]')?.remove();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          requestId: "case-123",
          reference: "DSAR-ABCD1234",
        }),
      })
    );
  });

  it("bootstraps CSRF and sends a request accepted by the real server guard", async () => {
    document.cookie = "vm_csrf=; Max-Age=0; path=/";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/csrf") {
        document.cookie = `vm_csrf=${csrfToken}; path=/`;
        return { ok: true, json: async () => ({ token: csrfToken }) };
      }
      const headers = new Headers(init?.headers);
      headers.set("cookie", document.cookie);
      expect(enforceCsrfToken({ headers, url: `http://localhost${url}` })).toBeNull();
      return { ok: true, json: async () => ({ reference: "DSAR-SECURE" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DsarPage />);
    fireEvent.change(screen.getByLabelText("Full Name *"), { target: { value: "Nomsa Dlamini" } });
    fireEvent.change(screen.getByLabelText("Email Address *"), {
      target: { value: "nomsa@example.com" },
    });
    fireEvent.change(screen.getByLabelText("SA ID Number *"), {
      target: { value: "8001015009087" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete captcha" }));
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
    await screen.findByText("Request Submitted");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not submit personal data when CSRF bootstrap fails", async () => {
    document.cookie = "vm_csrf=; Max-Age=0; path=/";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    render(<DsarPage />);
    fireEvent.change(screen.getByLabelText("Full Name *"), { target: { value: "Nomsa Dlamini" } });
    fireEvent.change(screen.getByLabelText("Email Address *"), {
      target: { value: "nomsa@example.com" },
    });
    fireEvent.change(screen.getByLabelText("SA ID Number *"), {
      target: { value: "8001015009087" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete captcha" }));
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/csrf");
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
  });

  it("uses a fresh single-use challenge after a server failure", async () => {
    const consumed = new Set<string>();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { turnstileToken: string };
      if (consumed.has(body.turnstileToken)) {
        return { ok: false, json: async () => ({ error: "CAPTCHA already consumed" }) };
      }
      consumed.add(body.turnstileToken);
      return {
        ok: consumed.size > 1,
        json: async () => ({ reference: "DSAR-RETRIED" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DsarPage />);
    fireEvent.change(screen.getByLabelText("Full Name *"), { target: { value: "Nomsa Dlamini" } });
    fireEvent.change(screen.getByLabelText("Email Address *"), {
      target: { value: "nomsa@example.com" },
    });
    fireEvent.change(screen.getByLabelText("SA ID Number *"), {
      target: { value: "8001015009087" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete captcha" }));
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Complete captcha" }));
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
    await screen.findByText("Request Submitted");
    expect(consumed.size).toBe(2);
  });

  it("renders the server-issued reference after a successful submission", async () => {
    render(<DsarPage />);

    fireEvent.change(screen.getByLabelText("Full Name *"), {
      target: { value: "Nomsa Dlamini" },
    });
    fireEvent.change(screen.getByLabelText("Email Address *"), {
      target: { value: "nomsa@example.com" },
    });
    fireEvent.change(screen.getByLabelText("SA ID Number *"), {
      target: { value: "8001015009087" },
    });
    fireEvent.change(screen.getByLabelText("Additional Details"), {
      target: { value: "Please send me a copy of my stored data." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Complete captcha" }));
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => {
      expect(screen.getByText("Request Submitted")).toBeInTheDocument();
    });

    expect(screen.getByText(/Reference: DSAR-ABCD1234/)).toBeInTheDocument();
    expect(screen.getByText(/Case ID: case-123/)).toBeInTheDocument();
  });

  it("shows a safe error message when submission fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "database exploded",
          requestId: "case-500",
          reference: "DSAR-FAIL500",
        }),
      })
    );

    render(<DsarPage />);

    fireEvent.change(screen.getByLabelText("Full Name *"), {
      target: { value: "Nomsa Dlamini" },
    });
    fireEvent.change(screen.getByLabelText("Email Address *"), {
      target: { value: "nomsa@example.com" },
    });
    fireEvent.change(screen.getByLabelText("SA ID Number *"), {
      target: { value: "8001015009087" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Complete captcha" }));
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalled();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Failed to submit request",
        description: expect.stringContaining("privacy@verifymzansi.com"),
      })
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("Reference: DSAR-FAIL500"),
      })
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.not.stringContaining("database exploded"),
      })
    );
  });
});
