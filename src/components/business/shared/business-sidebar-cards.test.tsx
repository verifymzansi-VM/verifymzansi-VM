/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/trust/trust-badge", () => ({
  TrustBadge: ({ level }: { level: string }) => <span data-testid="trust-badge">{level}</span>,
}));
vi.mock("@/components/shared/share-button", () => ({
  ShareButton: () => <button>Share</button>,
}));
vi.mock("@/components/shared/report-dialog", () => ({
  ReportDialog: () => <button>Report</button>,
}));

import { OperatingHoursCard, ManagedByCard, ShareReportRow } from "./business-sidebar-cards";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";

describe("OperatingHoursCard", () => {
  it("renders nothing when no hours provided", () => {
    const { container } = render(<OperatingHoursCard operatingHours={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders weekday and weekend hours", () => {
    render(
      <OperatingHoursCard
        operatingHours={{ Mon_Fri: "08:00 - 17:00", Sat: "09:00 - 13:00", Sun: "Closed" }}
      />
    );
    expect(screen.getByText("Operating Hours")).toBeInTheDocument();
    expect(screen.getByText("08:00 - 17:00")).toBeInTheDocument();
    expect(screen.getByText("09:00 - 13:00")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });
});

describe("ManagedByCard", () => {
  it("shows owner display name", () => {
    render(
      <ManagedByCard
        ownerProfile={{ display_name: "John Doe", avatar_url: null }}
        trustLevel={null}
      />
    );
    expect(screen.getByText("John Doe")).toBeInTheDocument();
  });

  it("shows fallback text when no owner profile", () => {
    render(<ManagedByCard ownerProfile={null} trustLevel={null} />);
    expect(screen.getByText("Verified Owner")).toBeInTheDocument();
  });

  it("renders trust badge when trust level is set", () => {
    render(
      <ManagedByCard
        ownerProfile={{ display_name: "Owner", avatar_url: null }}
        trustLevel="verified"
      />
    );
    expect(screen.getByTestId("trust-badge")).toBeInTheDocument();
  });
});

describe("ShareReportRow", () => {
  const biz = { id: "biz-1", business_name: "Test" } as BusinessDetailRecord;

  it("renders share and report buttons when public actions visible", () => {
    render(<ShareReportRow business={biz} showPublicActions={true} />);
    expect(screen.getByText("Share")).toBeInTheDocument();
    expect(screen.getByText("Report")).toBeInTheDocument();
  });

  it("renders nothing when public actions hidden", () => {
    const { container } = render(<ShareReportRow business={biz} showPublicActions={false} />);
    expect(container.firstChild).toBeNull();
  });
});
