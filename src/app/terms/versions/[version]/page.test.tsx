import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { awaitingForce, notFound } = vi.hoisted(() => ({
  awaitingForce: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/layout/header", () => ({ Header: () => <header /> }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => <footer /> }));
vi.mock("@/lib/legal/current-posting-terms", () => ({
  isPostingTermsVersionAwaitingForce: awaitingForce,
}));

import PostingTermsVersionPage from "./page";

const NOTICE = /Not in force yet\. This version applies only from the date we announce/;

async function renderVersion(version: string) {
  render(await PostingTermsVersionPage({ params: Promise.resolve({ version }) }));
}

describe("archived posting terms page", () => {
  beforeEach(() => {
    awaitingForce.mockReset();
    notFound.mockClear();
  });

  it("marks a version published ahead of time as not in force yet", async () => {
    awaitingForce.mockResolvedValue(true);
    await renderVersion("posting-v4");
    expect(awaitingForce).toHaveBeenCalledWith("posting-v4");
    expect(screen.getByText("Posting terms · posting-v4")).toBeInTheDocument();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Slots & prices/ })).toBeInTheDocument();
  });

  it("shows no notice for a version in force or an earlier one", async () => {
    awaitingForce.mockResolvedValue(false);
    await renderVersion("posting-v3");
    expect(screen.getByText("Posting terms · posting-v3")).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("answers not found for an unknown version without reading the database", async () => {
    await expect(renderVersion("posting-v5")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(awaitingForce).not.toHaveBeenCalled();
  });
});
