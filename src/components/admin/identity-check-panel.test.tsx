import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IdentityCheckPanel } from "./identity-check-panel";

describe("the Didit panel in the review case view", () => {
  it("shows the result, why it did not pass, the typed names and the member's request", () => {
    render(
      <IdentityCheckPanel
        check={{
          status: "declined",
          reasons: ["names_differ", "provider_in_review", "something_new"],
          createdAt: "2026-11-20T08:40:00Z",
          finishedAt: "2026-11-20T08:42:00Z",
          declinedAt: "2026-11-20T08:42:00Z",
          askedAt: "2026-11-21T07:00:00Z",
          askReason: "My ID book is old and the photo is faded.",
          typedNames: "Thando Sipho Dlamini",
        }}
      />
    );
    expect(screen.getByText("Didit declined")).toBeTruthy();
    expect(screen.getByText("Thando Sipho Dlamini")).toBeTruthy();
    expect(screen.getByText("Names typed differ from the names on the ID")).toBeTruthy();
    expect(screen.getByText("Didit was unsure")).toBeTruthy();
    expect(screen.getByText("something new")).toBeTruthy();
    expect(screen.getByText(/Asked a person to look again · 21 Nov 2026, 09:00/)).toBeTruthy();
    expect(screen.getByText("My ID book is old and the photo is faded.")).toBeTruthy();
  });

  it("shows a clean approval without reasons or a request", () => {
    render(
      <IdentityCheckPanel
        check={{
          status: "approved",
          reasons: [],
          createdAt: "2026-11-20T08:40:00Z",
          finishedAt: "2026-11-20T08:42:00Z",
          declinedAt: null,
          askedAt: null,
          askReason: null,
          typedNames: "Lerato Mokoena",
        }}
      />
    );
    expect(screen.getByText("Didit approved")).toBeTruthy();
    expect(screen.queryByRole("list", { name: /Why it did not pass/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Asked a person/)).not.toBeInTheDocument();
  });
});
