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
const OriginalURL = global.URL;
const VERIFICATION_TEMPORARILY_UNAVAILABLE_DESCRIPTION =
  "Verification is temporarily unavailable right now. Please try again later.";

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

function fetchCalls() {
  return (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
}

async function openCameraAndUseFileFallback(file: File) {
  fireEvent.click(screen.getByRole("button", { name: /Open Camera/i }));

  await waitFor(() => {
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: {
      files: [file],
    },
  });
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
    vi.stubGlobal(
      "URL",
      class MockURL extends OriginalURL {
        static createObjectURL = vi.fn(() => "blob:test");
        static revokeObjectURL = vi.fn();
      }
    );
    Object.defineProperty(global.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(),
      },
    });
    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(global.navigator, "permissions", {
      configurable: true,
      value: undefined,
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
      expect(
        screen.getAllByRole("heading", { name: /Verification Submitted/i }).length
      ).toBeGreaterThan(0);
    });
    expect(
      screen.getByText(/Everything was submitted to admin.*pending review/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Pending Review/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Save Address/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit Verification/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Return to Posting/i })).toHaveAttribute(
      "href",
      "/post/create-business"
    );
  });

  it("keeps the completed state on revisit when the session is finalized after location submission", async () => {
    sessionResponse = jsonResponse(
      {
        sessionId: "session-finalized",
        completedSteps: ["phone", "location"],
        pendingSteps: ["id_doc", "selfie"],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: "2026-04-21T12:00:00.000Z",
        phoneVerifiedAt: "2026-04-21T11:50:00.000Z",
      },
      200
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "incomplete",
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "pending" },
          { step_type: "selfie", status: "pending" },
          { step_type: "location", status: "approved" },
        ],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(
        screen.getAllByRole("heading", { name: /Verification Submitted/i }).length
      ).toBeGreaterThan(0);
    });
    expect(
      screen.getByText(/Everything was submitted to admin\. Your application is pending review\./i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Step 1: Phone \+ OTP/i)).not.toBeInTheDocument();
  });

  it("does not let duplicate approved step rows hide a resubmission state", async () => {
    sessionResponse = jsonResponse(
      {
        sessionId: "session-duplicate-steps",
        completedSteps: ["phone", "id_doc", "selfie", "location"],
        pendingSteps: [],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: "2026-04-21T12:00:00.000Z",
        phoneVerifiedAt: "2026-04-21T11:50:00.000Z",
      },
      200
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "verified",
        steps: [
          { step_type: "phone", status: "approved" },
          {
            step_type: "id_doc",
            status: "needs_resubmission",
            reason_note: "Please upload a clearer ID photo.",
          },
          {
            step_type: "id_doc",
            status: "approved",
            reviewed_at: "2026-04-20T10:00:00.000Z",
          },
          {
            step_type: "selfie",
            status: "approved",
            reviewed_at: "2026-04-20T10:05:00.000Z",
          },
          { step_type: "location", status: "approved" },
        ],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByText(/Action needed on id doc/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Please upload a clearer ID photo/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 2: ID details/i)).toBeInTheDocument();
    expect(screen.queryByText(/Verification Approved/i)).not.toBeInTheDocument();
  });

  it("opens approved accounts on the completion view even when old step records are incomplete", async () => {
    sessionResponse = jsonResponse(
      {
        sessionId: "session-verified-legacy",
        completedSteps: ["phone"],
        pendingSteps: [],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: null,
        phoneVerifiedAt: "2026-04-21T11:50:00.000Z",
      },
      200
    );
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "verified",
        steps: [{ step_type: "phone", status: "approved" }],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: /Verification Approved/i }).length).toBe(2);
    });

    expect(screen.getAllByText(/Your account is verified/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/4 of 4 steps submitted/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^Approved$/i).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/Step 2: ID details/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/First name as shown on your ID is required/i)
    ).not.toBeInTheDocument();
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
    render(<VerificationPage />);

    fireEvent.change(screen.getByLabelText(/SA mobile number/i), {
      target: { value: "0712345678" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send code/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));

    await waitFor(() => {
      expect(fetchCalls().some(([input]) => String(input).includes("/api/otp/send"))).toBe(true);
      expect(screen.getByLabelText(/6-digit code/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Code expires in/i)).toBeInTheDocument();
    expect(screen.queryByText(/Dev OTP:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Test OTP:/i)).not.toBeInTheDocument();
  });

  it("shows resend cooldown guidance after a successful OTP send", async () => {
    render(<VerificationPage />);

    fireEvent.change(screen.getByLabelText(/SA mobile number/i), {
      target: { value: "0712345678" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send code/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));

    await waitFor(() => {
      expect(fetchCalls().some(([input]) => String(input).includes("/api/otp/send"))).toBe(true);
      expect(screen.getByRole("button", { name: /Resend code/i })).toBeDisabled();
    });
    expect(screen.getByText(/You can resend a new code in 30s/i)).toBeInTheDocument();
    expect(screen.getByText(/SMS delivery can take up to 60 seconds/i)).toBeInTheDocument();
  });

  it("shows retry guidance when OTP send is rate limited", async () => {
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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send code/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));

    await waitFor(() => {
      expect(fetchCalls().some(([input]) => String(input).includes("/api/otp/send"))).toBe(true);
      expect(screen.getByText(/You can resend a new code in 45s/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Too many code requests were made for this number/i)
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Send code/i })).toBeDisabled();
    expect(screen.queryByLabelText(/6-digit code/i)).not.toBeInTheDocument();
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

    expect(
      await screen.findByText(VERIFICATION_EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/13-digit SA ID number/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Continue$/i })).toBeDisabled();
  });

  it("blocks the verification flow when session start reports v2 is unavailable", async () => {
    sessionResponse = jsonResponse({ error: "New verification flow is not yet enabled" }, 404);
    statusResponse = jsonResponse({ error: "Account profile not found" }, 404);

    render(<VerificationPage />);

    expect(
      await screen.findByText(VERIFICATION_TEMPORARILY_UNAVAILABLE_DESCRIPTION)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/SA mobile number/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /Send code/i })).toBeDisabled();
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

    fireEvent.change(screen.getByLabelText(/First name \(as shown on ID\)/i), {
      target: { value: "Sipho" },
    });
    fireEvent.change(screen.getByLabelText(/Surname \(as shown on ID\)/i), {
      target: { value: "Mokoena" },
    });

    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });

    await openCameraAndUseFileFallback(new File(["fake-img"], "id.jpg", { type: "image/jpeg" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Continue$/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(
        fetchCalls().some(([input]) => String(input).includes("/api/verification/upload"))
      ).toBe(true);
      expect(
        screen.getByText(/Confirm your email before submitting documents and location/i)
      ).toBeInTheDocument();
    });
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
        requestId: "req_test_123",
      },
      503
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/13-digit SA ID number/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/First name \(as shown on ID\)/i), {
      target: { value: "Sipho" },
    });
    fireEvent.change(screen.getByLabelText(/Surname \(as shown on ID\)/i), {
      target: { value: "Mokoena" },
    });

    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });

    await openCameraAndUseFileFallback(new File(["fake-img"], "id.jpg", { type: "image/jpeg" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Continue$/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(
      () => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "ID document upload failed",
            description:
              "ID document upload is temporarily unavailable. Please try again in a moment. Ref: req_test_123",
          })
        );
      },
      { timeout: 3500 }
    );
  });

  it("supports file fallback on the selfie step after ID document submission", async () => {
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

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/13-digit SA ID number/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/First name \(as shown on ID\)/i), {
      target: { value: "Sipho" },
    });
    fireEvent.change(screen.getByLabelText(/Surname \(as shown on ID\)/i), {
      target: { value: "Mokoena" },
    });
    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });

    await openCameraAndUseFileFallback(new File(["fake-id"], "id.jpg", { type: "image/jpeg" }));

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Step 3: Selfie/i)).toBeInTheDocument();
    });

    await openCameraAndUseFileFallback(
      new File(["fake-selfie"], "selfie.jpg", { type: "image/jpeg" })
    );

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Step 4: Verify Your Address/i)).toBeInTheDocument();
    });

    const verificationUploadCalls = fetchCalls().filter(([input]) =>
      String(input).includes("/api/verification/upload")
    );
    expect(verificationUploadCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("treats duplicate pending ID uploads as already submitted and advances to the selfie step", async () => {
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
        error: "Upload already in progress for this step",
        code: "duplicate_pending_artifact",
      },
      409
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/13-digit SA ID number/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/First name \(as shown on ID\)/i), {
      target: { value: "Sipho" },
    });
    fireEvent.change(screen.getByLabelText(/Surname \(as shown on ID\)/i), {
      target: { value: "Mokoena" },
    });
    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });

    await openCameraAndUseFileFallback(new File(["fake-id"], "id.jpg", { type: "image/jpeg" }));

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Step 3: Selfie/i)).toBeInTheDocument();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Already submitted",
        description:
          "Your ID document is already pending review. You can continue without uploading it again.",
      })
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
      expect(screen.getByRole("button", { name: /Save Address/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Province$/i), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Address/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Confirm your email first",
          description: VERIFICATION_EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION,
        })
      );
    });
    expect(screen.getByRole("button", { name: /Save Address/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Submit Verification/i })).toBeDisabled();
  });

  it("keeps a saved address visible without a verification tick until GPS succeeds", async () => {
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

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Save Address/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Province$/i), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.change(screen.getByLabelText(/Town \/ Suburb/i), {
      target: { value: "Soweto" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Address/i }));

    await waitFor(() => {
      expect(screen.getByText(/^Saved address$/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Soweto, Johannesburg, Gauteng/i).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /Verify Address with GPS/i })).toBeInTheDocument();
    });

    expect(screen.queryByText(/^GPS-verified address$/i)).not.toBeInTheDocument();
  });

  it("shows a verified address state after successful GPS confirmation", async () => {
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
        success: true,
        verified: true,
        confidence: "high",
        resolvedProvince: "Gauteng",
        resolvedCity: "Johannesburg",
      },
      200
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
      expect(screen.getByRole("button", { name: /Save Address/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Province$/i), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Address/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Verify Address with GPS/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Verify Address with GPS/i }));

    await waitFor(() => {
      expect(screen.getByText(/^GPS-verified address$/i)).toBeInTheDocument();
      expect(screen.getByText(/Address verified by GPS/i)).toBeInTheDocument();
      expect(screen.getByText(/GPS verified \(GPS: high\)/i)).toBeInTheDocument();
    });
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
      expect(screen.getByRole("button", { name: /Save Address/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Province$/i), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Address/i }));

    await waitFor(() => {
      expect(screen.getByText(/^Saved address$/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Verify Address with GPS/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Verify Address with GPS/i }));

    await waitFor(() => {
      expect(
        fetchCalls().some(([input]) => String(input).includes("/api/verification/location/gps"))
      ).toBe(true);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Confirm your email first",
          description: VERIFICATION_EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION,
        })
      );
    });
    expect(screen.getByRole("button", { name: /Verify Address with GPS/i })).toBeDisabled();
  });

  it("stays on completion after final submit when prior document steps are already persisted", async () => {
    sessionResponse = jsonResponse(
      {
        sessionId: "session-ready-for-location",
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
          { step_type: "id_doc", status: "pending", submitted_at: "2026-03-08T11:05:00.000Z" },
          { step_type: "selfie", status: "pending", submitted_at: "2026-03-08T11:06:00.000Z" },
        ],
      }),
      200
    );
    manualLocationResponse = jsonResponse({ success: true }, 200);

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByText(/Step 4: Verify Your Address/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Province$/i), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Address/i }));

    await waitFor(() => {
      expect(screen.getByText(/^Saved address$/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Submit Verification/i }));

    await waitFor(() => {
      expect(
        screen.getAllByRole("heading", { name: /Verification Submitted/i }).length
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/Step 1: Phone \+ OTP/i)).not.toBeInTheDocument();
  });
});
