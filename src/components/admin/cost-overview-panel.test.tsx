import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostOverviewPanel, formatQuantity, type CostOverview } from "./cost-overview-panel";

const overview: CostOverview = {
  generated_at: "2026-10-14T20:00:00Z",
  lines: [
    {
      metric: "object_storage_bytes",
      label: "Photos, videos and ID documents stored",
      unit: "bytes",
      provider: "Cloudflare R2",
      period: "current",
      used: String(9.5 * 1024 ** 3),
      free_quantity: String(10 * 1024 ** 3),
      percent_of_free: 95,
      level: "critical",
      measurement: "database_observation",
      billing_scope: "account",
      overage_note: "Billed per GB-month beyond the free tier",
      verified_on: "2026-10-15",
    },
    {
      metric: "worker_requests_day",
      label: "Website requests per day",
      unit: "count",
      provider: "Cloudflare Workers",
      period: "current",
      used: null,
      free_quantity: "100000",
      percent_of_free: null,
      level: "check_provider",
      overage_note: "Read from the Cloudflare dashboard",
      verified_on: null,
    },
  ],
  drivers: {
    accounts: 1200,
    new_accounts_this_month: 80,
    live_posts: 640,
    uploads_last_30_days: 3100,
    average_bytes_per_live_post: String(18 * 1024 ** 2),
    unused_media_bytes_awaiting_cleanup: "0",
    expired_posts_awaiting_deletion: 25,
    evidence_files: 300,
    posts_by_status: { live: 640 },
  },
  largest_storage_accounts: [
    {
      account_id: "0f1e2d3c-aaaa-bbbb-cccc-000000000001",
      bytes: 2 * 1024 ** 3,
      live_posts: 90,
      package_posts: 100,
    },
  ],
  open_alarms: [
    {
      id: "a1",
      metric: "object_storage_bytes",
      level: "critical",
      period: "2026-10",
      raised_at: "2026-10-14T19:00:00Z",
    },
  ],
};

describe("CostOverviewPanel", () => {
  it("formats bytes and counts", () => {
    expect(formatQuantity(1536, "bytes")).toBe("1.5 KB");
    expect(formatQuantity(String(10 * 1024 ** 3), "bytes")).toBe("10.7 GB");
    expect(formatQuantity(null, "bytes")).toBe("—");
    expect(formatQuantity(100000, "count")).toBe((100000).toLocaleString("en-ZA"));
  });

  it("shows each cost line against its free allowance and flags alarms", () => {
    render(<CostOverviewPanel overview={overview} />);
    expect(screen.getByRole("alert")).toHaveTextContent("object_storage_bytes (critical)");
    expect(screen.getByText("Over 90% of free allowance")).toBeInTheDocument();
    expect(screen.getByText("Check the provider dashboard")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: /Photos, videos/ })).toHaveAttribute(
      "aria-valuenow",
      "95"
    );
    expect(screen.getByText("Largest storage users")).toBeInTheDocument();
  });
  it("does not present unchecked allowances or estimates as a verified budget", () => {
    const unchecked: CostOverview = {
      ...overview,
      open_alarms: [],
      lines: [
        { ...overview.lines[0], level: "ok", verified_on: null, measurement: "estimate" },
        {
          ...overview.lines[0],
          metric: "unknown",
          free_quantity: null,
          level: "no_free_allowance",
        },
        { ...overview.lines[0], metric: "estimate", measurement: "estimate" },
      ],
    };
    render(<CostOverviewPanel overview={unchecked} />);
    expect(screen.getByText("Free allowance not verified")).toBeInTheDocument();
    expect(screen.getByText("Allowance unknown")).toBeInTheDocument();
    expect(screen.getByText("Estimated use — check provider")).toBeInTheDocument();
    expect(screen.queryByText("Within free allowance")).not.toBeInTheDocument();
    expect(screen.queryByText("Charged per use")).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });
});
