// My posts shows the deletion date that the owner's post reads return
// (database update 20261109104020_post_expiry_rules.sql), as plain text in the
// row's details line.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import ListingsPage from "@/app/dashboard/listings/page";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readRestoredPostManager } from "@/lib/foundation/post-manager";

vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: vi.fn(),
  FoundationServerSessionError: class extends Error {},
}));
vi.mock("@/lib/foundation/post-manager", () => ({ readRestoredPostManager: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ tryCreateAdminClient: vi.fn(() => null) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <div aria-label={alt} data-src={src} role="img" />
  ),
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children }: PropsWithChildren<{ value: string }>) => (
    <button type="button">{children}</button>
  ),
  TabsContent: ({ children }: PropsWithChildren<{ value: string }>) => <div>{children}</div>,
}));
vi.mock("@/components/dashboard/area-filter", () => ({ AreaFilter: () => null }));
vi.mock("@/components/listings/boost-button", () => ({ BoostButton: () => null }));
vi.mock("@/components/listings/featured-button", () => ({ FeaturedButton: () => null }));
vi.mock("@/components/listings/urgent-button", () => ({ UrgentButton: () => null }));
vi.mock("@/components/listings/resubmit-button", () => ({ ResubmitButton: () => null }));
vi.mock("@/components/listings/delete-post-button", () => ({ DeletePostButton: () => null }));
vi.mock("@/components/listings/post-account-button", () => ({ PostAccountButton: () => null }));
vi.mock("@/components/listings/content-lifecycle-button", () => ({
  ContentLifecycleButton: () => null,
}));

const row = (overrides: Record<string, unknown>) => ({
  status: "live",
  created_at: "2026-11-01T08:00:00Z",
  area: "MZANSI_MARKET",
  photos: [],
  price_cents: 1000,
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T10:00:00.000Z"));
  vi.mocked(readFoundationServerSession).mockResolvedValue({
    user: { id: "native-owner" },
    account: { account_id: "native-owner" },
    api: { rpc: vi.fn() },
  } as unknown as Awaited<ReturnType<typeof readFoundationServerSession>>);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("shows 'Will be deleted on' with the date for posts that have a deletion date", async () => {
  vi.mocked(readRestoredPostManager).mockResolvedValue({
    responses: [
      {
        data: [
          row({
            id: "sold",
            title: "Sold bicycle",
            status: "sold",
            deletes_at: "2026-11-12T08:00:00Z",
          }),
          row({
            id: "live",
            title: "Live kettle",
            expires_at: "2026-12-01T08:00:00Z",
            deletes_at: null,
          }),
        ],
        error: null,
      },
      {
        data: [
          row({
            id: "business",
            business_name: "Expired salon",
            status: "expired",
            area: "MZANSI_BUSINESS",
            deletes_at: "2026-11-10T22:30:00Z",
          }),
        ],
        error: null,
      },
      { data: [], error: null },
    ],
    sponsoredIds: new Set(),
    slotUsage: [],
    planAdmins: [],
    tiers: { MZANSI_MARKET: "starter", MZANSI_BUSINESS: "starter", PROMOTIONS_EVENTS: "starter" },
  } as unknown as Awaited<ReturnType<typeof readRestoredPostManager>>);
  render(await ListingsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Sold bicycle")).toBeInTheDocument();
  expect(screen.getByText("Will be deleted on 12 November 2026")).toBeInTheDocument();
  // 22:30 UTC is the next day in South Africa.
  expect(screen.getByText("Will be deleted on 11 November 2026")).toBeInTheDocument();
  expect(screen.getAllByText(/^Will be deleted on /)).toHaveLength(2);
});
