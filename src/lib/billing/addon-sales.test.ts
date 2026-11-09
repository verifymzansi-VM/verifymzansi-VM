/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADDON_SALES_PAUSED_CODE,
  ADDON_SALES_PAUSED_MESSAGE,
  ADDON_SALES_SWITCH,
  addonSalesPausedResponse,
  areAddonSalesOpen,
} from "./addon-sales";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("paid add-on sales switch", () => {
  it("is paused when the switch is missing, as in a fresh environment", () => {
    expect(process.env[ADDON_SALES_SWITCH]).toBeUndefined();
    expect(areAddonSalesOpen()).toBe(false);
    expect(areAddonSalesOpen({})).toBe(false);
  });

  it("opens only for the exact value true", () => {
    expect(areAddonSalesOpen({ ADDON_SALES_ENABLED: "true" })).toBe(true);
    vi.stubEnv("ADDON_SALES_ENABLED", "true");
    expect(areAddonSalesOpen()).toBe(true);
  });

  it.each([
    "",
    "false",
    "0",
    "1",
    "TRUE",
    "True",
    "yes",
    "on",
    "enabled",
    " true",
    "true ",
    "true\n",
    "'true'",
    '"true"',
  ])("stays paused for %j (fails closed)", (value) => {
    expect(areAddonSalesOpen({ ADDON_SALES_ENABLED: value })).toBe(false);
    vi.stubEnv("ADDON_SALES_ENABLED", value);
    expect(areAddonSalesOpen()).toBe(false);
  });

  it("ignores switches with another name", () => {
    expect(
      areAddonSalesOpen({
        addon_sales_enabled: "true",
        ADDON_SALES: "true",
        ADDONS_ENABLED: "true",
      })
    ).toBe(false);
  });
});

describe("paused reply", () => {
  it("is the friendly message with a stable code, never cached", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = addonSalesPausedResponse("urgent");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: ADDON_SALES_PAUSED_MESSAGE,
      code: ADDON_SALES_PAUSED_CODE,
    });
    expect(ADDON_SALES_PAUSED_MESSAGE).toBe("Add-ons open soon. You have not been charged.");
  });

  it("logs only the fixed entry-point name, and only at debug level", () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    addonSalesPausedResponse("foundation_addon");
    expect(debug).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
    const line = String(debug.mock.calls[0][0]);
    expect(line).toContain("foundation_addon");
    expect(line).toContain("Paid add-on checkout refused while add-on sales are paused");
    expect(line).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("writes nothing at production's default level, however often it is asked", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "");
    const calls = (["debug", "info", "warn", "error", "log"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined)
    );
    for (let request = 0; request < 50; request++) addonSalesPausedResponse("urgent");
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });
});
