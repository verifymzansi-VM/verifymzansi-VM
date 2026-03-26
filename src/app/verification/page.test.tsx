import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VerificationPage from "./page";
import { useSearchParams } from "next/navigation";
import type { VerificationStatus } from "@/types/enums";
import {
  VERIFICATION_EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION,
  VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE,
  VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
} from "@/lib/constants/verification-email-confirmation";

const mockToast = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header">Header</header>,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

type StepStatus = {
  step_type: "phone" | "id_doc" | "selfie" | "location";
  status: VerificationStatus;
  reviewed_at?: string | null;
  reason_code?: string | null;
  reason_note?: string | null;
  risk_level?: string | null;
  submitted_at?: string | null;
};

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: {
      get: (name: string) => headers?.[name] ?? headers?.[name.toLowerCase()] ?? null,
    },
  };
}

function buildStatusPayload({
  accountVerificationStatus = "incomplete",
  steps = [],
}: {
  accountVerificationStatus?: "incomplete" | "pending_review" | "verified" | "rejected";
  steps?: StepStatus[];
}) {
  return {
    accountVerificationStatus,
    overallStatus: accountVerificationStatus,
    steps,
  };
}

describe("VerificationPage", () => {
  let sessionResponse: ReturnType<typeof jsonResponse>;
  let statusResponse: ReturnType<typeof jsonResponse>;
  let otpSendResponse: ReturnType<typeof jsonResponse>;
  let otpVerifyResponse: ReturnType<typeof jsonResponse>;
  let verificationUploadResponse: ReturnType<typeof jsonResponse>;
  let manualLocationResponse: ReturnType<typeof jsonResponse>;
  let gpsResponse: ReturnType<typeof jsonResponse>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    Object.defineProperty(global.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(),
      },
    });
    sessionResponse = jsonResponse(
      {
        sessionId: "session-1",
        completedSteps: [],
        pendingSteps: [],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: null,
        phoneVerifiedAt: null,
      },
      200
    );
    statusResponse = jsonResponse(buildStatusPayload({}), 200);
    otpSendResponse = jsonResponse({ success: true }, 200);
    otpVerifyResponse = jsonResponse({ success: true, verified: true }, 200);
    verificationUploadResponse = jsonResponse({ success: true }, 200);
    manualLocationResponse = jsonResponse({ success: true }, 200);
    gpsResponse = jsonResponse({ success: true }, 200);

    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new URLSearchParams());

    global.fetch = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/verification/session/start")) {
        return Promise.resolve(sessionResponse);
      }
      if (url.includes("/api/verification/status")) {
        return Promise.resolve(statusResponse);
      }
      if (url.includes("/api/otp/send")) {
        return Promise.resolve(otpSendResponse);
      }
      if (url.includes("/api/otp/verify")) {
        return Promise.resolve(otpVerifyResponse);
      }
      if (url.includes("/api/verification/upload")) {
        return Promise.resolve(verificationUploadResponse);
      }
      if (url.includes("/api/verification/location/manual")) {
        return Promise.resolve(manualLocationResponse);
      }
      if (url.includes("/api/verification/location/gps")) {
        return Promise.resolve(gpsResponse);
      }
      return Promise.resolve(jsonResponse({}, 200));
    }) as unknown as typeof fetch;
  });

  it("uses the supplied returnUrl on the completion card and shows the review summary", async () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("returnUrl=%2Fpost%2Fcreate-business")
    );

    sessionResponse = jsonResponse(
      {
        sessionId: "session-1",
        completedSteps: ["phone"],
        pendingSteps: ["id_doc", "selfie", "location"],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: "2026-03-08T12:00:00.000Z",
        phoneVerifiedAt: "2026-03-08T11:00:00.000Z",
      },
      200
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "pending_review",
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "pending" },
          { step_type: "selfie", status: "pending" },
          { step_type: "location", status: "pending" },
        ],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Verification Submitted/i })).toBeInTheDocument();
    });
    expect(
      screen.getByText(/phone, documents, and location details are under admin review/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Pending review/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Return to Posting/i })).toHaveAttribute(
      "href",
      "/post/create-business"
    );
  });

  it("surfaces resubmission reasons on the affected step", async () => {
    sessionResponse = jsonResponse(
      {
        sessionId: "session-2",
        completedSteps: ["phone"],
        pendingSteps: [],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: null,
        phoneVerifiedAt: "2026-03-08T11:00:00.000Z",
      },
      200
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "rejected",
        steps: [
          { step_type: "phone", status: "approved" },
          {
            step_type: "id_doc",
            status: "needs_resubmission",
            reason_note: "Please upload a clearer photo of the full ID card.",
            reason_code: "blurry_image",
          },
        ],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByText(/Needs resubmission/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Please upload a clearer photo of the full ID card/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Action needed on id doc/i)).toBeInTheDocument();
  });

  it("never renders OTP helper hints after sending a real OTP", async () => {
    sessionResponse = jsonResponse({ error: "New verification flow is not yet enabled" }, 404);
    statusResponse = jsonResponse({ error: "Account profile not found" }, 404);

    render(<VerificationPage />);

    fireEvent.change(screen.getByLabelText(/SA mobile number/i), {
      target: { value: "0712345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/6-digit OTP/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Codes expire after 5 minutes/i)).toBeInTheDocument();
    expect(screen.queryByText(/Dev OTP:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Test OTP:/i)).not.toBeInTheDocument();
  });

  it("shows resend cooldown guidance after a successful OTP send", async () => {
    sessionResponse = jsonResponse({ error: "New verification flow is not yet enabled" }, 404);
    statusResponse = jsonResponse({ error: "Account profile not found" }, 404);

    render(<VerificationPage />);

    fireEvent.change(screen.getByLabelText(/SA mobile number/i), {
      target: { value: "0712345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Resend code/i })).toBeDisabled();
    });
    expect(screen.getByText(/You can resend a new code in 30s/i)).toBeInTheDocument();
    expect(screen.getByText(/SMS delivery can take up to 60 seconds/i)).toBeInTheDocument();
  });

  it("shows retry guidance when OTP send is rate limited", async () => {
    sessionResponse = jsonResponse({ error: "New verification flow is not yet enabled" }, 404);
    statusResponse = jsonResponse({ error: "Account profile not found" }, 404);
    otpSendResponse = jsonResponse(
      {
        error: "Too many OTP requests. Please wait before trying again.",
        code: "rate_limited",
        retryAfter: 45,
      },
      429,
      { "Retry-After": "45" }
    );

    render(<VerificationPage />);

    fireEvent.change(screen.getByLabelText(/SA mobile number/i), {
      target: { value: "0712345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));

    await waitFor(() => {
      expect(screen.getByText(/Wait 45s before resending/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Send code/i })).toBeDisabled();
    expect(screen.queryByLabelText(/6-digit OTP/i)).not.toBeInTheDocument();
  });

  it("falls back to /dashboard when no returnUrl is provided", async () => {
    sessionResponse = jsonResponse(
      {
        sessionId: "session-1",
        completedSteps: ["phone"],
        pendingSteps: ["id_doc", "selfie", "location"],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: "2026-03-08T12:00:00.000Z",
        phoneVerifiedAt: "2026-03-08T11:00:00.000Z",
      },
      200
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "pending_review",
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "pending" },
          { step_type: "selfie", status: "pending" },
          { step_type: "location", status: "pending" },
        ],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Go to Dashboard/i })).toHaveAttribute(
        "href",
        "/dashboard"
      );
    });
  });

  it("renders the email-confirmation blocker when session start is blocked", async () => {
    sessionResponse = jsonResponse(
      {
        error: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
        code: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE,
      },
      403
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        steps: [{ step_type: "phone", status: "approved" }],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/Confirm your email before submitting documents and location/i)
      ).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/13-digit SA ID number/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Continue$/i })).toBeDisabled();
  });

  it("shows the explicit email-confirmation blocker when upload is rejected", async () => {
    sessionResponse = jsonResponse(
      {
        sessionId: "session-1",
        completedSteps: ["phone"],
        pendingSteps: [],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: null,
        phoneVerifiedAt: "2026-03-08T11:00:00.000Z",
      },
      200
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        steps: [{ step_type: "phone", status: "approved" }],
      }),
      200
    );
    verificationUploadResponse = jsonResponse(
      {
        error: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
        code: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE,
      },
      403
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/13-digit SA ID number/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });
    fireEvent.change(screen.getByLabelText(/ID file \(image\/PDF\)/i), {
      target: {
        files: [new File(["fake-pdf"], "id.pdf", { type: "application/pdf" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Confirm your email first",
          description: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
        })
      );
    });
    expect(
      screen.getByText(/Confirm your email before submitting documents and location/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/13-digit SA ID number/i)).toBeDisabled();
  });

  it("shows the shared temporary-unavailable message when KYC storage is unavailable", async () => {
    sessionResponse = jsonResponse(
      {
        sessionId: "session-1",
        completedSteps: ["phone"],
        pendingSteps: [],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: null,
        phoneVerifiedAt: "2026-03-08T11:00:00.000Z",
      },
      200
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        steps: [{ step_type: "phone", status: "approved" }],
      }),
      200
    );
    verificationUploadResponse = jsonResponse(
      {
        error: "Document upload temporarily unavailable",
        code: "storage_unavailable",
      },
      503
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/13-digit SA ID number/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });
    fireEvent.change(screen.getByLabelText(/ID file \(image\/PDF\)/i), {
      target: {
        files: [new File(["fake-pdf"], "id.pdf", { type: "application/pdf" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(
      () => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "ID document upload failed",
            description:
              "ID document upload is temporarily unavailable. Please try again in a moment.",
          })
        );
      },
      { timeout: 3500 }
    );
  });

  it("shows the explicit email-confirmation blocker when manual location is rejected", async () => {
    sessionResponse = jsonResponse(
      {
        sessionId: "session-1",
        completedSteps: ["phone", "id_doc", "selfie"],
        pendingSteps: [],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: null,
        phoneVerifiedAt: "2026-03-08T11:00:00.000Z",
      },
      200
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "approved" },
          { step_type: "selfie", status: "approved" },
        ],
      }),
      200
    );
    manualLocationResponse = jsonResponse(
      {
        error: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
        code: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE,
      },
      403
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Submit Location/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Province$/i), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText(/City \/ Town/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Submit Location/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Confirm your email first",
          description: VERIFICATION_EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION,
        })
      );
    });
    expect(screen.getByRole("button", { name: /Submit Location/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Final Submit/i })).toBeDisabled();
  });

  it("shows the explicit email-confirmation blocker when GPS verification is rejected", async () => {
    sessionResponse = jsonResponse(
      {
        sessionId: "session-1",
        completedSteps: ["phone", "id_doc", "selfie"],
        pendingSteps: [],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: null,
        phoneVerifiedAt: "2026-03-08T11:00:00.000Z",
      },
      200
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "approved" },
          { step_type: "selfie", status: "approved" },
        ],
      }),
      200
    );
    manualLocationResponse = jsonResponse({ success: true }, 200);
    gpsResponse = jsonResponse(
      {
        error: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
        code: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE,
      },
      403
    );
    const mockGetCurrentPosition = vi.fn((success: PositionCallback) =>
      success({
        coords: {
          latitude: -26.2041,
          longitude: 28.0473,
          accuracy: 12,
        } as GeolocationCoordinates,
        timestamp: Date.now(),
      } as GeolocationPosition)
    );
    Object.defineProperty(global.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: mockGetCurrentPosition,
      },
    });

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Submit Location/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Province$/i), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText(/City \/ Town/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Submit Location/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Confirm with GPS/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Confirm with GPS/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Confirm your email first",
          description: VERIFICATION_EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION,
        })
      );
    });
    expect(screen.getByRole("button", { name: /Confirm with GPS/i })).toBeDisabled();
  });
});
