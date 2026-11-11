import { beforeEach, describe, expect, it, vi } from "vitest";
import { readNativeAreaActivity, readNativeProgramReports } from "./area-activity-server";
import { readFrontendAreaActivity } from "./area-activity";
import { readFrontendReportQueue } from "./report-queue";
import { readFoundationServerSession } from "./server-session";

vi.mock("./server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("./report-queue", () => ({ readFrontendReportQueue: vi.fn() }));
vi.mock("./area-activity", () => ({ readFrontendAreaActivity: vi.fn() }));

const staff = "00000000-0000-4000-8000-000000000001";
const api = { marker: "api" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readFoundationServerSession).mockResolvedValue({ user: { id: staff }, api } as never);
});

const programmes = [
  ["MZANSI_MARKET", "market"],
  ["MZANSI_BUSINESS", "business"],
  ["PROMOTIONS_EVENTS", "tourism_events"],
] as const;

describe("readNativeProgramReports", () => {
  it.each(programmes)("reads %s reports as the %s area", async (programme, area) => {
    vi.mocked(readFrontendReportQueue).mockResolvedValueOnce({ items: [] } as never);
    await expect(readNativeProgramReports(programme)).resolves.toEqual({ items: [] });
    expect(readFrontendReportQueue).toHaveBeenCalledWith(api, staff, area);
  });

  it.each(["MALL", "toString", "market"])("refuses the unknown programme %s", async (value) => {
    await expect(readNativeProgramReports(value)).rejects.toThrow("Unknown program");
    expect(readFrontendReportQueue).not.toHaveBeenCalled();
  });
});

describe("readNativeAreaActivity", () => {
  it.each(programmes)("reads %s activity as the %s area", async (programme, area) => {
    await readNativeAreaActivity(programme, 7);
    expect(readFrontendAreaActivity).toHaveBeenCalledWith(api, staff, area, 7);
  });

  it("reads activity across all areas, twenty at a time, when no programme is given", async () => {
    await readNativeAreaActivity();
    expect(readFrontendAreaActivity).toHaveBeenCalledWith(api, staff, undefined, 20);
  });

  it("refuses an unknown programme before reading the session", async () => {
    await expect(readNativeAreaActivity("constructor", 5)).rejects.toThrow("Unknown program");
    expect(readFoundationServerSession).not.toHaveBeenCalled();
    expect(readFrontendAreaActivity).not.toHaveBeenCalled();
  });
});
