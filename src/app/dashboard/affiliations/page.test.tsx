import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readWorkspace: vi.fn(),
  panel: vi.fn(),
}));
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: mocks.readSession,
}));
vi.mock("@/lib/foundation/affiliation-workspace", () => ({
  readAffiliationWorkspace: mocks.readWorkspace,
}));
vi.mock("@/components/organisations/affiliation-request-panel", () => ({
  AffiliationRequestPanel: (props: unknown) => {
    mocks.panel(props);
    return null;
  },
}));

import AffiliationsPage from "./page";

const api = { fixture: "api" };
const workspace = {
  account_id: "member-1",
  businesses: [{ id: "business-1", name: "Nomsa Beauty Studio", status: "live" }],
  applications: [],
  affiliations: [],
  administered: [{ name: "Ekurhuleni Chamber", slug: "ekurhuleni-chamber" }],
  preselected: { name: "Ekurhuleni Chamber", slug: "ekurhuleni-chamber" },
};

describe("affiliation dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSession.mockResolvedValue({ api, user: { id: "member-1" } });
    mocks.readWorkspace.mockResolvedValue(workspace);
  });

  it("shows the member's businesses and the organisations they administer", async () => {
    render(
      await AffiliationsPage({ searchParams: Promise.resolve({ org: "ekurhuleni-chamber" }) })
    );

    expect(mocks.readWorkspace).toHaveBeenCalledWith(api, "ekurhuleni-chamber");
    expect(screen.getByRole("link", { name: "Ekurhuleni Chamber dashboard" })).toHaveAttribute(
      "href",
      "/dashboard/organisation/ekurhuleni-chamber"
    );
    expect(mocks.panel).toHaveBeenCalledWith(
      expect.objectContaining({
        businesses: workspace.businesses,
        preselect: workspace.preselected,
      })
    );
  });

  it("ignores an organisation link that is not a valid slug", async () => {
    render(await AffiliationsPage({ searchParams: Promise.resolve({ org: "../admin" }) }));

    expect(mocks.readWorkspace).toHaveBeenCalledWith(api, undefined);
  });

  it("refuses a workspace that belongs to a different account", async () => {
    mocks.readWorkspace.mockResolvedValue({ ...workspace, account_id: "member-2" });

    await expect(AffiliationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "Current account changed"
    );
  });

  it("uses the dashboard error boundary when the workspace is unavailable", async () => {
    mocks.readWorkspace.mockRejectedValue(new Error("Affiliations are temporarily unavailable"));

    await expect(AffiliationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "Affiliations are temporarily unavailable"
    );
  });
});
