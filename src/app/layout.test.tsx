import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue("nonce-123"),
  }),
}));

vi.mock("@/components/providers/theme-provider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/providers/public-runtime-config", () => ({
  PublicRuntimeConfigBridge: () => <div data-testid="runtime-config" />,
}));

vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

vi.mock("@/components/service-worker-registrar", () => ({
  ServiceWorkerRegistrar: () => <div data-testid="service-worker-registrar" />,
}));

import RootLayout from "./layout";

describe("RootLayout", () => {
  it("renders the __name bootstrap script before the app shell", async () => {
    const markup = renderToStaticMarkup(
      await RootLayout({
        children: <div id="page-content">Marketplace</div>,
      })
    );

    const scriptIndex = markup.indexOf("var __name=globalThis.__name;");
    const skipLinkIndex = markup.indexOf('href="#main-content"');

    expect(markup).toContain('nonce="nonce-123"');
    expect(markup).toContain("globalThis.__name");
    expect(scriptIndex).toBeGreaterThan(-1);
    expect(scriptIndex).toBeLessThan(skipLinkIndex);
    expect(markup).toContain("Marketplace");
  });
});
