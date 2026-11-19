import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PackageMoveFailure } from "@/lib/foundation/package-move-failures";
import { PackageMoveAttention } from "./package-move-attention";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const failure: PackageMoveFailure = {
  package_id: "11111111-1111-4111-8111-111111111111",
  owner_name: "Sipho D.",
  post_id: "22222222-2222-4222-8222-222222222222",
  post_title: "Demo bakkie 2.4",
  direction: "into_package",
  tries: 14,
  first_failed_at: "2026-11-18T08:02:00.000Z",
  last_failed_at: "2026-11-18T08:16:00.000Z",
  reason: "busy",
  package_ends_at: "2026-12-24T08:00:00.000Z",
  stuck: true,
};

describe("PackageMoveAttention (P4a)", () => {
  it("shows nothing while no package move fails", () => {
    const { container } = render(<PackageMoveAttention failures={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each failing move with the post, tries, first failure, reason and package", () => {
    render(
      <PackageMoveAttention
        failures={[
          failure,
          {
            ...failure,
            post_id: null,
            post_title: null,
            direction: "into_package",
            tries: 1,
            reason: "busy",
            stuck: false,
            package_ends_at: null,
            owner_name: null,
          },
          {
            ...failure,
            post_id: "33333333-3333-4333-8333-333333333333",
            direction: "out_of_package",
            reason: "error P0001",
            stuck: false,
          },
        ]}
      />
    );
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
    expect(screen.getByText("Post could not move into the package")).toBeInTheDocument();
    expect(screen.getByText("Post could not move out of the package")).toBeInTheDocument();
    expect(screen.getByText("The package was busy")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /“Demo bakkie 2\.4” · tried 14 times since 18 Nov 2026, 10:02 · reason: busy/
      )
    ).toHaveLength(1);
    expect(screen.getByText(/tried 1 time since/)).toBeInTheDocument();
    expect(screen.getByText(/reason: error P0001/)).toBeInTheDocument();
    expect(
      screen.getAllByText("Package of Sipho D. · ends 24 Dec 2026, 10:00 (SA time)")
    ).toHaveLength(2);
    expect(
      screen.getByText(`Package ${failure.package_id} · ended or refunded`)
    ).toBeInTheDocument();
    // A stuck move is marked in red; the others in gold.
    const items = screen.getAllByRole("listitem");
    expect(items[0].className).toContain("border-destructive");
    expect(items[1].className).toContain("border-brand-gold");
  });
});
