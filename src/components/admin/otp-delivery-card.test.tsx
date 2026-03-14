/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OtpDeliveryCard } from "./otp-delivery-card";
import type { RecentOtpAttempt } from "@/lib/utils/admin-queries";

describe("OtpDeliveryCard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an empty state when no OTP attempts are available", () => {
    render(<OtpDeliveryCard attempts={[]} />);

    expect(screen.getByText(/Recent OTP Delivery/i)).toBeInTheDocument();
    expect(screen.getByText(/No OTP attempts recorded yet/i)).toBeInTheDocument();
  });

  it("renders masked phone details and provider failure metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T10:15:00.000Z"));

    const attempts: RecentOtpAttempt[] = [
      {
        id: "otp-1",
        phone: "+27821234567",
        delivery_status: "failed",
        provider_name: "africastalking",
        provider_message_id: null,
        provider_error: "HTTP 401: Generator rejected",
        verified: false,
        verified_at: null,
        created_at: "2026-03-14T10:10:00.000Z",
        expires_at: "2026-03-14T10:14:00.000Z",
      },
      {
        id: "otp-2",
        phone: "+27821230000",
        delivery_status: "sent",
        provider_name: "africastalking",
        provider_message_id: "sms-2",
        provider_error: null,
        verified: true,
        verified_at: "2026-03-14T10:12:30.000Z",
        created_at: "2026-03-14T10:12:00.000Z",
        expires_at: "2026-03-14T10:17:00.000Z",
      },
    ];

    render(<OtpDeliveryCard attempts={attempts} />);

    expect(screen.getByText("+27 •••• ••67")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("HTTP 401: Generator rejected")).toBeInTheDocument();
    expect(screen.getAllByText("Provider: africastalking")).toHaveLength(2);
    expect(screen.getByText("Message ID: not recorded")).toBeInTheDocument();
    expect(screen.getByText("Expires: expired")).toBeInTheDocument();
    expect(screen.getByText("Verified at: not verified")).toBeInTheDocument();

    expect(screen.getByText("+27 •••• ••00")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Message ID: sms-2")).toBeInTheDocument();
  });
});
