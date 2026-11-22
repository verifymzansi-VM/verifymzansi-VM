import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ShowroomHelpPage from "./page";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => null }));

describe("How the showroom works", () => {
  it("states the fair showroom's rules: turns, 3 new days, 3 / 2 / 2 places, video and likes", () => {
    render(<ShowroomHelpPage />);
    const rules = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent)
      .slice(0, 5);
    expect(rules).toEqual([
      "Everyone takes turns",
      "New posts get a head start and a New tag for 3 days",
      "Near you first, never only near you",
      "A small nudge for video",
      "Likes help a little",
    ]);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(
      /3 go to posts from your city, 2 to the rest of your province and 2 to the rest of South Africa/
    );
    expect(text).toMatch(/for that page only and never store it/);
    expect(text).toMatch(/more than twice its fair share this week/);
    expect(text).toMatch(/Editing or renewing a post does not make it new again/);
    expect(text).toMatch(/likes never jump the queue/);
  });
});
