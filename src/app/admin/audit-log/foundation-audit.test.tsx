import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "./page";
const { legacy } = vi.hoisted(() => ({ legacy: vi.fn() }));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: legacy }));
vi.mock("@/components/foundation/staff-audit-page", () => ({
  FoundationStaffAuditPage: () => <p>Native staff audit</p>,
}));
it("routes the production audit page to the native read model without retired table queries", async () => {
  render(await Page({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Native staff audit")).toBeInTheDocument();
  expect(legacy).not.toHaveBeenCalled();
});
