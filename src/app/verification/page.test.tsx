import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VerificationPage from "./page";
import { useSearchParams } from "next/navigation";
import type { VerificationStatus } from "@/types/enums";
import type * as HiddenFeatures from "@/lib/hidden-features";
import {
  VERIFICATION_EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION,
  VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE,
  VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
} from "@/lib/constants/verification-email-confirmation";

const mockToast = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), addBreadcrumb: vi.fn() }));
// The camera has its own tests (src/components/ui/camera-capture.test.tsx).
// Here a stand-in takes a photo the way the real one hands it to the page:
// a camera JPEG, with the face check passed for the selfie. It never offers a
// file input, like the real one. `photo.bytes` sets the photo's size.
const photo = vi.hoisted(() => ({ bytes: null as number | null }));
vi.mock("@/components/ui/camera-capture", () => ({
  CameraCapture: ({
    onCapture,
    onContinueOnPhone,
    documentGuide,
  }: {
    onCapture: (file: File, meta?: { livenessPassed: boolean; captureToken?: string }) => void;
    onContinueOnPhone?: () => void;
    documentGuide?: boolean;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          const file = new File(["photo"], "capture.jpg", { type: "image/jpeg" });
          if (photo.bytes !== null) Object.defineProperty(file, "size", { value: photo.bytes });
          onCapture(file, {
            livenessPassed: !documentGuide,
            captureToken: documentGuide ? "id-capture-token" : "selfie-capture-token",
          });
        }}
      >
        Take test photo
      </button>
      {onContinueOnPhone && (
        <button type="button" onClick={onContinueOnPhone}>
          Continue on your phone
        </button>
      )}
    </div>
  ),
}));
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

// "Detect province and city" is hidden until it works; its tests switch it on.
const hidden = vi.hoisted(() => ({ detect: false }));
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  get SHOW_LOCATION_DETECTION() {
    return hidden.detect;
  },
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

/** Takes a photo with the (stand-in) camera on the current step. */
async function takeCameraPhoto() {
  fireEvent.click(await screen.findByRole("button", { name: /Take test photo/i }));
}

describe("VerificationPage", () => {
  let statusResponse: ReturnType<typeof jsonResponse>;
  let otpSendResponse: ReturnType<typeof jsonResponse>;
  let otpVerifyResponse: ReturnType<typeof jsonResponse>;
  let verificationUploadResponse: ReturnType<typeof jsonResponse>;
  let manualLocationResponse: ReturnType<typeof jsonResponse>;
  let gpsResponse: ReturnType<typeof jsonResponse>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    hidden.detect = false;
    photo.bytes = null;
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
    statusResponse = jsonResponse(buildStatusPayload({}), 200);
    otpSendResponse = jsonResponse({ success: true }, 200);
    otpVerifyResponse = jsonResponse({ success: true, verified: true }, 200);
    verificationUploadResponse = jsonResponse({ success: true }, 200);
    manualLocationResponse = jsonResponse({ success: true }, 200);
    gpsResponse = jsonResponse({ success: true }, 200);

    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new URLSearchParams());

    global.fetch = vi.fn((input: string | URL) => {
      const url = String(input);
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
      if (url.includes("/api/verification/location/detect")) {
        return Promise.resolve(gpsResponse);
      }
      return Promise.resolve(jsonResponse({}, 200));
    }) as unknown as typeof fetch;
  });

  it("uses the supplied returnUrl on the completion card and shows the review summary", async () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("returnUrl=%2Fpost%2Fcreate-business")
    );

    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "pending_review",
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
    expect(screen.getByText(/Your location is approved.*pending review/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Pending Review/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Save location/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit Verification/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Return to Posting/i })).toHaveAttribute(
      "href",
      "/post/create-business"
    );
  });

  it("shows per-step approval decisions on the submitted summary", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "pending_review",
        steps: [
          { step_type: "phone", status: "approved" },
          {
            step_type: "id_doc",
            status: "approved",
            reviewed_at: "2026-05-23T12:10:00.000Z",
          },
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

    const summary = within(screen.getByRole("region", { name: /Verification submitted/i }));
    expect(
      within(summary.getByText("ID document").closest("div")!).getByText("Approved")
    ).toBeTruthy();
    expect(
      within(summary.getByText("Selfie").closest("div")!).getByText("Pending review")
    ).toBeTruthy();
    expect(
      within(summary.getByText("Location").closest("div")!).getByText("Approved")
    ).toBeTruthy();
  });

  it("shows a neutral status check before rendering any verification step", async () => {
    render(<VerificationPage />);

    expect(screen.getByText(/Loading your latest verification status/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Step 1: Phone \+ OTP/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Verification Submitted/i)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByLabelText(/SA mobile number/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Loading your latest verification status/i)).not.toBeInTheDocument();
  });

  it("keeps verification steps hidden while status is slow to load", async () => {
    const slowStatus = deferred<ReturnType<typeof jsonResponse>>();
    global.fetch = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/verification/status")) {
        return slowStatus.promise;
      }
      return Promise.resolve(jsonResponse({}, 200));
    }) as unknown as typeof fetch;

    render(<VerificationPage />);

    await waitFor(() => {
      expect(
        fetchCalls().some(([input]) => String(input).includes("/api/verification/status"))
      ).toBe(true);
    });
    expect(screen.getByText(/Loading your latest verification status/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/SA mobile number/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Step 1: Phone \+ OTP/i })
    ).not.toBeInTheDocument();

    slowStatus.resolve(statusResponse);

    await waitFor(() => {
      expect(screen.getByLabelText(/SA mobile number/i)).toBeInTheDocument();
    });
  });

  it("only reads the saved status on page view; nothing is started until the member acts", async () => {
    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/SA mobile number/i)).toBeInTheDocument();
    });

    const calls = fetchCalls();
    expect(calls.map(([input]) => String(input))).toEqual(["/api/verification/status"]);
    for (const [, init] of calls) {
      expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    }
    expect(calls.some(([input]) => String(input).includes("/api/verification/session/start"))).toBe(
      false
    );

    // The member's own click is what reaches the server with a change.
    fireEvent.change(screen.getByLabelText(/SA mobile number/i), {
      target: { value: "0712345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));
    await waitFor(() => {
      expect(fetchCalls().some(([input]) => String(input).includes("/api/otp/send"))).toBe(true);
    });
    expect(
      fetchCalls().some(([input]) => String(input).includes("/api/verification/session/start"))
    ).toBe(false);
  });

  it("shows a verified phone as approved on the completion card", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "pending_review",
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

    expect(screen.getByText(/4 of 4 steps submitted/i)).toBeInTheDocument();
    const phoneRows = screen
      .getAllByText(/^Phone$/i)
      .map((element) => element.closest("div"))
      .filter((element): element is HTMLDivElement => element !== null);
    expect(phoneRows.some((row) => within(row).queryByText(/^Approved$/i) !== null)).toBe(true);
  });

  it("keeps the completed state on revisit after location submission", async () => {
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
      screen.getByText(/Your location is approved\. Your identity documents are pending review\./i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Step 1: Phone \+ OTP/i })
    ).not.toBeInTheDocument();
  });

  it("does not reopen the location form once the identity is accepted", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "verified",
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "approved" },
          { step_type: "selfie", status: "approved" },
        ],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(
        screen.getAllByRole("heading", { name: /Verification Approved/i }).length
      ).toBeGreaterThan(0);
    });

    expect(
      screen.queryByRole("heading", { name: /Step 4: Confirm your province and city/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Select Your Location/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save location/i })).not.toBeInTheDocument();
  });

  it("does not let duplicate approved step rows hide a resubmission state", async () => {
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
    expect(screen.getAllByText(/Please upload a clearer ID photo/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /Step 2: ID details/i })).toBeInTheDocument();
    expect(screen.queryByText(/Verification Approved/i)).not.toBeInTheDocument();
  });

  it("opens approved accounts on the completion view even when old step records are incomplete", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "verified",
        steps: [{ step_type: "phone", status: "approved" }],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: /Verification Approved/i }).length).toBe(1);
      expect(
        screen.getByRole("heading", { level: 1, name: /You're verified/i })
      ).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Your account is verified/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/4 of 4 steps submitted/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^Approved$/i).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole("heading", { name: /Step 2: ID details/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/First name as shown on your ID is required/i)
    ).not.toBeInTheDocument();
  });

  it("surfaces resubmission reasons on the affected step", async () => {
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
      screen.getAllByText(/Please upload a clearer photo of the full ID card/i).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Action needed on id doc/i)).toBeInTheDocument();
  });

  it("shows rejected selfie guidance without hiding an approved location", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "rejected",
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "approved" },
          { step_type: "selfie", status: "rejected" },
          { step_type: "location", status: "approved" },
        ],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByText(/Action needed on selfie/i)).toBeInTheDocument();
    });

    expect(
      screen.getAllByText(/Your selfie was not accepted\. Retake a clear selfie/i).length
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Location: approved/i)).toBeInTheDocument();
  });

  it("returns to pending status after resubmitting selfie when location is already approved", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "rejected",
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "approved" },
          { step_type: "selfie", status: "rejected" },
          { step_type: "location", status: "approved" },
        ],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Step 3: Selfie/i })).toBeInTheDocument();
    });

    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "pending_review",
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "approved" },
          { step_type: "selfie", status: "pending", submitted_at: "2026-05-24T08:00:00.000Z" },
          { step_type: "location", status: "approved" },
        ],
      }),
      200
    );

    await takeCameraPhoto();
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Verification Submitted/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Your location is approved/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Selfie: pending/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Location: approved/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Step 4: Confirm your province and city/i })
    ).not.toBeInTheDocument();
  });

  it("returns to location confirmation after selfie resubmission when legacy location is pending", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "rejected",
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "approved" },
          { step_type: "selfie", status: "rejected" },
          { step_type: "location", status: "pending" },
        ],
      }),
      200
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Step 3: Selfie/i })).toBeInTheDocument();
    });

    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "pending_review",
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "approved" },
          { step_type: "selfie", status: "pending", submitted_at: "2026-05-24T08:00:00.000Z" },
          { step_type: "location", status: "pending" },
        ],
      }),
      200
    );

    await takeCameraPhoto();
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await screen.findByRole("heading", { name: /Step 4: Confirm your province and city/i });
    expect(screen.getByRole("button", { name: /Save location/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Verification submitted/i })
    ).not.toBeInTheDocument();
  });

  it("never renders OTP helper hints after sending a real OTP", async () => {
    render(<VerificationPage />);

    fireEvent.change(await screen.findByLabelText(/SA mobile number/i), {
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

    fireEvent.change(await screen.findByLabelText(/SA mobile number/i), {
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

    fireEvent.change(await screen.findByLabelText(/SA mobile number/i), {
      target: { value: "0712345678" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send code/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));

    await waitFor(() => {
      expect(fetchCalls().some(([input]) => String(input).includes("/api/otp/send"))).toBe(true);
      expect(screen.getByText(/You can resend a new code in 45s/i)).toBeInTheDocument();
    });
    // The reason sits under the number, not in a toast.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Too many OTP requests. Please wait before trying again."
    );
    expect(screen.getByLabelText(/SA mobile number/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /Send code/i })).toBeDisabled();
    expect(screen.queryByLabelText(/6-digit code/i)).not.toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    // Editing the number keeps a wait that is still running.
    fireEvent.change(screen.getByLabelText(/SA mobile number/i), {
      target: { value: "0712345679" },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send code/i })).toBeDisabled();
  });

  it.each([
    ["phone_in_use", "This phone number is already linked to another account.", 409],
    ["phone_already_verified", "This phone number is already verified on your account.", 409],
    [
      "phone_banned",
      "This phone number can't be used on VerifyMzansi. Contact support if you think this is a mistake.",
      403,
    ],
  ])(
    "says why no code was sent (%s) without the SMS delivery hint",
    async (code, error, status) => {
      otpSendResponse = jsonResponse({ error, reason: code, code }, status);

      render(<VerificationPage />);

      fireEvent.change(await screen.findByLabelText(/SA mobile number/i), {
        target: { value: "0712345678" },
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Send code/i })).toBeEnabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /Send code/i }));

      // The reason sits under the number field, not in a toast.
      expect(await screen.findByRole("alert")).toHaveTextContent(error);
      const number = screen.getByLabelText(/SA mobile number/i);
      expect(number).toHaveAttribute("aria-invalid", "true");
      expect(number).toHaveAttribute("aria-describedby", "phone-error");
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      );
      expect(screen.queryByText(/SMS delivery can take up to 60 seconds/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/6-digit code/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Send code/i })).toBeEnabled();
      // Editing the number clears it.
      fireEvent.change(number, { target: { value: "0712345679" } });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
  );

  it("shows a wrong code under the code field, not in a toast", async () => {
    otpVerifyResponse = jsonResponse(
      { error: "Check the number or code, or request a new code" },
      400
    );
    render(<VerificationPage />);
    fireEvent.change(await screen.findByLabelText(/SA mobile number/i), {
      target: { value: "0712345678" },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send code/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));
    const code = await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify code/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check the number or code, or request a new code"
    );
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAttribute("aria-describedby", "otp-error");
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    fireEvent.change(code, { target: { value: "12345" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to /dashboard when no returnUrl is provided", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "pending_review",
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
      expect(screen.getByRole("link", { name: /Go to Dashboard/i })).toHaveAttribute(
        "href",
        "/dashboard"
      );
    });
  });

  it("blocks the verification flow when no verification service answers", async () => {
    statusResponse = jsonResponse({ error: "Account profile not found" }, 404);

    render(<VerificationPage />);

    expect(
      await screen.findByText(VERIFICATION_TEMPORARILY_UNAVAILABLE_DESCRIPTION)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/SA mobile number/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /Send code/i })).toBeDisabled();
  });

  it("shows the explicit email-confirmation blocker when upload is rejected", async () => {
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

    fireEvent.change(screen.getByLabelText(/All first names \(as on your ID\)/i), {
      target: { value: "Sipho" },
    });
    fireEvent.change(screen.getByLabelText(/Surname \(as on your ID\)/i), {
      target: { value: "Mokoena" },
    });

    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });

    await takeCameraPhoto();
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

    fireEvent.change(screen.getByLabelText(/All first names \(as on your ID\)/i), {
      target: { value: "Sipho" },
    });
    fireEvent.change(screen.getByLabelText(/Surname \(as on your ID\)/i), {
      target: { value: "Mokoena" },
    });

    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });

    await takeCameraPhoto();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Continue$/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(
      () => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Your ID photo wasn't sent",
            description:
              "ID document can't be sent right now. Please try again in a moment. Ref: req_test_123",
          })
        );
      },
      { timeout: 3500 }
    );
  });

  it("LIM-APP-verification-page-precheck: accepts a 5 MB ID photo, refuses one byte more", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        steps: [{ step_type: "phone", status: "approved" }],
      }),
      200
    );
    render(<VerificationPage />);
    fireEvent.change(await screen.findByLabelText(/All first names \(as on your ID\)/i), {
      target: { value: "Sipho" },
    });
    fireEvent.change(screen.getByLabelText(/Surname \(as on your ID\)/i), {
      target: { value: "Mokoena" },
    });
    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });

    photo.bytes = 5 * 1024 * 1024 + 1;
    await takeCameraPhoto();
    expect(await screen.findByText("File must be under 5MB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Continue$/i })).toBeDisabled();

    photo.bytes = 5 * 1024 * 1024;
    await takeCameraPhoto();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Continue$/i })).toBeEnabled();
    });
    expect(screen.queryByText("File must be under 5MB")).not.toBeInTheDocument();
  });

  it("sends camera photos for the ID and the selfie, never a file", async () => {
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

    fireEvent.change(screen.getByLabelText(/All first names \(as on your ID\)/i), {
      target: { value: "Sipho" },
    });
    fireEvent.change(screen.getByLabelText(/Surname \(as on your ID\)/i), {
      target: { value: "Mokoena" },
    });
    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });

    await takeCameraPhoto();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Step 3: Selfie/i })).toBeInTheDocument();
    });

    await takeCameraPhoto();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Step 4: Confirm your province and city/i })
      ).toBeInTheDocument();
    });

    const verificationUploadCalls = fetchCalls().filter(([input]) =>
      String(input).includes("/api/verification/upload")
    );
    expect(verificationUploadCalls.length).toBeGreaterThanOrEqual(2);
    for (const [, init] of verificationUploadCalls) {
      const body = (init as RequestInit).body as FormData;
      expect(body.get("captureMethod")).toBe("camera");
      expect(body.get("captureToken")).toBe(
        body.get("docType") === "selfie" ? "selfie-capture-token" : "id-capture-token"
      );
    }
    const selfieBody = (verificationUploadCalls.at(-1)![1] as RequestInit).body as FormData;
    expect(selfieBody.get("docType")).toBe("selfie");
    expect(selfieBody.get("livenessPassed")).toBe("true");
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("labels the names as on the ID and continues on a phone with the typed details", async () => {
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
    expect(
      screen.getByText(/Type every first name in the same order as your ID/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Photos from your gallery or files can't be used/i)
    ).toBeInTheDocument();

    // Without the details, the phone link is not made.
    fireEvent.click(screen.getByRole("button", { name: /Continue on your phone/i }));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Enter your names and ID number first" })
    );
    expect(
      fetchCalls().some(([input]) => String(input).includes("/api/verification/handoff"))
    ).toBe(false);

    fireEvent.change(screen.getByLabelText(/All first names \(as on your ID\)/i), {
      target: { value: "Thando Sipho" },
    });
    fireEvent.change(screen.getByLabelText(/Surname \(as on your ID\)/i), {
      target: { value: "Dlamini" },
    });
    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue on your phone/i }));

    await screen.findByRole("heading", { name: /Step 2: Continue on your phone/i });
    await waitFor(() => {
      const call = fetchCalls().find(([input]) =>
        String(input).includes("/api/verification/handoff")
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        idNumber: "8001015009087",
        firstName: "Thando Sipho",
        lastName: "Dlamini",
      });
    });
    expect(
      screen.getByText(/Works once, for 15 minutes, only for your account/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));
    expect(await screen.findByLabelText(/13-digit SA ID number/i)).toBeInTheDocument();
  });

  describe("the independent ID check", () => {
    const phoneDone = () =>
      jsonResponse(
        buildStatusPayload({ steps: [{ step_type: "phone", status: "approved" }] }),
        200
      );
    function withAvailability(...answers: unknown[]) {
      const queue = [...answers];
      const base = global.fetch as unknown as (input: string | URL, init?: RequestInit) => unknown;
      global.fetch = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/verification/identity-check" && (init?.method ?? "GET") === "GET")
          return Promise.resolve(jsonResponse(queue.length > 1 ? queue.shift() : queue[0], 200));
        if (url === "/api/verification/identity-check")
          return Promise.resolve(jsonResponse({ checkId: "c", url: "https://verify.didit.me/s" }));
        return base(input, init);
      }) as unknown as typeof fetch;
    }

    it("leaves the ID step exactly as today on the Manual setting", async () => {
      statusResponse = phoneDone();
      withAvailability({ route: "manual", reason: "mode", check: null });
      render(<VerificationPage />);
      await waitFor(() =>
        expect(
          fetchCalls().some(([input]) => String(input) === "/api/verification/identity-check")
        ).toBe(true)
      );
      expect(screen.getByLabelText(/13-digit SA ID number/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Take test photo/i })).toBeInTheDocument();
      expect(
        screen.getByText(/Our team checks your ID, usually within 1–2 working days/i)
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Start ID check/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/independent verification/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/isn't available right now/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/kept until 5 years/i)).not.toBeInTheDocument();
    });

    it("says the automatic check isn't available when paused, on the camera route", async () => {
      statusResponse = phoneDone();
      withAvailability({ route: "manual", reason: "paused", check: null });
      render(<VerificationPage />);
      expect(await screen.findByText(/automatic check isn't available right now/i)).toBeTruthy();
      expect(screen.getByLabelText(/13-digit SA ID number/i)).toBeInTheDocument();
    });

    it("starts a check only after the consent tick, sending the consent with it", async () => {
      statusResponse = phoneDone();
      withAvailability({ route: "automatic", reason: null, check: null });
      render(<VerificationPage />);
      const start = await screen.findByRole("button", { name: /Start ID check/i });
      expect(screen.queryByLabelText(/13-digit SA ID number/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Take test photo/i })).not.toBeInTheDocument();
      expect(screen.getByText(/kept until 5 years/i)).toBeTruthy();
      expect(screen.getByRole("link", { name: /Verification Privacy Notice/i })).toHaveAttribute(
        "href",
        "https://didit.me/terms/verification-privacy-notice"
      );
      fireEvent.change(screen.getByLabelText(/All first names \(as on your ID\)/i), {
        target: { value: "Thando Sipho" },
      });
      fireEvent.change(screen.getByLabelText(/Surname \(as on your ID\)/i), {
        target: { value: "Dlamini" },
      });
      expect(start).toBeDisabled();
      fireEvent.click(start);
      const posts = () =>
        fetchCalls().filter(
          ([input, init]) =>
            String(input) === "/api/verification/identity-check" &&
            (init as RequestInit | undefined)?.method === "POST"
        );
      expect(posts()).toHaveLength(0);

      fireEvent.click(screen.getByLabelText(/I agree that VerifyMzansi asks/i));
      expect(start).toBeEnabled();
      fireEvent.click(start);
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(JSON.parse(String((posts()[0][1] as RequestInit).body))).toEqual({
        consent: true,
        consentVersion: "identity-check-consent-v1",
        firstName: "Thando Sipho",
        lastName: "Dlamini",
      });
    });

    it("shows the check in the page, then the result", async () => {
      statusResponse = phoneDone();
      withAvailability(
        {
          route: "automatic",
          reason: null,
          check: { id: "c", status: "started", session_url: "https://verify.didit.me/s" },
        },
        { route: "automatic", reason: null, check: { id: "c", status: "approved" } }
      );
      render(<VerificationPage />);
      const frame = await screen.findByTitle(/Independent ID check/i);
      expect(frame).toHaveAttribute("src", "https://verify.didit.me/s");
      expect(frame).toHaveAttribute("allow", "camera");
      // A message from another origin changes nothing.
      window.dispatchEvent(
        new MessageEvent("message", { origin: "https://evil.example", data: "didit:completed" })
      );
      expect(screen.queryByText(/Checking your ID/i)).not.toBeInTheDocument();
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://verify.didit.me",
          data: { type: "didit:completed" },
        })
      );
      expect(await screen.findByText(/Your ID is verified/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: /Continue to location/i })).toBeTruthy();
    });

    it("offers 'try again' and 'ask a person' after a fully automatic decline", async () => {
      statusResponse = phoneDone();
      withAvailability({
        route: "automatic",
        reason: null,
        check: {
          id: "22222222-2222-4222-8222-222222222222",
          status: "declined",
          decline_reason: "names_differ",
          can_ask_person: true,
          ask_person_until: "2026-11-25T10:00:00Z",
          asked_at: null,
        },
      });
      render(<VerificationPage />);
      expect(await screen.findByText(/We couldn’t verify your ID/i)).toBeTruthy();
      expect(screen.getByText(/don't match the names on your ID/i)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Ask a person to look again/i }));
      const send = screen.getByRole("button", { name: /Send to a person/i });
      expect(send).toBeDisabled();
      fireEvent.change(screen.getByLabelText(/Anything we should know/i), {
        target: { value: "My ID book is old and the photo is faded." },
      });
      fireEvent.click(send);
      await waitFor(() => {
        const call = fetchCalls().find(
          ([input]) => String(input) === "/api/verification/identity-check/ask"
        );
        expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
          checkId: "22222222-2222-4222-8222-222222222222",
          reason: "My ID book is old and the photo is faded.",
        });
      });
    });
  });

  it("treats duplicate pending ID uploads as already submitted and advances to the selfie step", async () => {
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

    fireEvent.change(screen.getByLabelText(/All first names \(as on your ID\)/i), {
      target: { value: "Sipho" },
    });
    fireEvent.change(screen.getByLabelText(/Surname \(as on your ID\)/i), {
      target: { value: "Mokoena" },
    });
    fireEvent.change(screen.getByLabelText(/13-digit SA ID number/i), {
      target: { value: "8001015009087" },
    });

    await takeCameraPhoto();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Step 3: Selfie/i })).toBeInTheDocument();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Already submitted",
        description:
          "Your ID document is already pending review. You can continue without sending it again.",
      })
    );
  });

  it("shows the explicit email-confirmation blocker when manual location is rejected", async () => {
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
      expect(screen.getByRole("button", { name: /Save location/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Province$/i), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save location/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Confirm your email first",
          description: VERIFICATION_EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION,
        })
      );
    });
    expect(screen.getByRole("button", { name: /Save location/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Submit Verification/i })).not.toBeInTheDocument();
  });

  it("finishes verification when the address is saved", async () => {
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
      expect(screen.getByRole("button", { name: /Save location/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Province$/i), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save location/i }));

    await waitFor(() => {
      expect(
        screen.getAllByRole("heading", { name: /Verification Submitted/i }).length
      ).toBeGreaterThan(0);
    });

    expect(screen.queryByRole("button", { name: /Submit Verification/i })).not.toBeInTheDocument();
  });

  async function openLocationStep() {
    statusResponse = jsonResponse(
      buildStatusPayload({
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "approved" },
          { step_type: "selfie", status: "approved" },
        ],
      })
    );
    render(<VerificationPage />);
    await screen.findByRole("button", { name: /Save location/i });
  }

  it("hides location detection until it works; the list still saves", async () => {
    await openLocationStep();
    expect(
      screen.queryByRole("button", { name: /Detect province and city/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Detection is approximate/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Province$/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: /Save location/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Location approved" })
      )
    );
    expect(fetchCalls().some(([url]) => String(url).includes("location/detect"))).toBe(false);
  });

  it("suggests province and city without submitting or requesting GPS", async () => {
    hidden.detect = true;
    gpsResponse = jsonResponse({ detected: true, province: "Gauteng", city: "Johannesburg" });
    await openLocationStep();
    expect(screen.queryByLabelText(/Town \/ Suburb/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Detect province and city/i }));
    await waitFor(() => expect(screen.getByLabelText(/^City$/i)).toHaveValue("Johannesburg"));
    expect(screen.getByLabelText(/^Province$/i)).toHaveValue("Gauteng");
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(fetchCalls().some(([url]) => String(url).includes("location/manual"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Save location/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Location approved" })
      )
    );
    const saved = fetchCalls().find(([url]) => String(url).includes("location/manual"));
    expect(JSON.parse(saved![1].body)).toEqual({ province: "Gauteng", city: "Johannesburg" });
  });

  it.each([200, 503])("allows manual selection when detection fails (%s)", async (status) => {
    hidden.detect = true;
    gpsResponse = jsonResponse({ detected: false, province: null, city: null }, status);
    await openLocationStep();
    fireEvent.click(screen.getByRole("button", { name: /Detect province and city/i }));
    await screen.findByText(/We could not detect your province and city/i);
    fireEvent.change(screen.getByLabelText(/^Province$/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: /Save location/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Location approved" })
      )
    );
  });

  it("reopens legacy pending location for self-service approval", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        accountVerificationStatus: "pending_review",
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "pending" },
          { step_type: "selfie", status: "pending" },
          { step_type: "location", status: "pending" },
        ],
      })
    );
    render(<VerificationPage />);
    await screen.findByRole("button", { name: /Save location/i });
    fireEvent.change(screen.getByLabelText(/^Province$/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: "Johannesburg" } });
    expect(screen.getByRole("button", { name: /Save location/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Save location/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Location approved" })
      )
    );
  });

  it("stays on completion after saving location when prior document steps are already persisted", async () => {
    statusResponse = jsonResponse(
      buildStatusPayload({
        steps: [
          { step_type: "phone", status: "approved" },
          { step_type: "id_doc", status: "pending", submitted_at: "2026-03-08T11:05:00.000Z" },
          { step_type: "selfie", status: "pending", submitted_at: "2026-03-08T11:06:00.000Z" },
        ],
      }),
      200
    );
    manualLocationResponse = jsonResponse({ success: true }, 200);

    render(<VerificationPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Step 4: Confirm your province and city/i })
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^Province$/i), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save location/i }));

    await waitFor(() => {
      expect(
        screen.getAllByRole("heading", { name: /Verification Submitted/i }).length
      ).toBeGreaterThan(0);
    });
    expect(
      screen.queryByRole("heading", { name: /Step 1: Phone \+ OTP/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit Verification/i })).not.toBeInTheDocument();
  });
});
