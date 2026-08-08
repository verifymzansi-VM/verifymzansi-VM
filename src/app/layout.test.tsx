import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn((name: string) => {
      if (name === "x-nonce") return "nonce-123";
      if (name === "x-csrf-token") return "a".repeat(64);
      return null;
    }),
  }),
}));

vi.mock("next/font/google", () => ({
  Sora: () => ({ className: "sora", variable: "--font-display", style: {} }),
  Inter: () => ({ className: "inter", variable: "--font-body", style: {} }),
}));

vi.mock("@/components/providers/theme-provider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/providers/public-runtime-config", () => ({
  PublicRuntimeConfigBridge: () => <div data-testid="runtime-config" />,
}));

vi.mock("@/components/layout/desktop-page-shell", () => ({
  DesktopPageShell: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

vi.mock("@/components/service-worker-registrar", () => ({
  ServiceWorkerRegistrar: () => <div data-testid="service-worker-registrar" />,
}));

import RootLayout from "./layout";
import { headers } from "next/headers";

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
    expect(markup).toContain(`<meta name="csrf-token" content="${"a".repeat(64)}"/>`);
    expect(markup).toContain("globalThis.__name");
    expect(scriptIndex).toBeGreaterThan(-1);
    expect(scriptIndex).toBeLessThan(skipLinkIndex);
    expect(markup).toContain("Marketplace");
  });

  it("injects auth cache recovery before the app shell on auth pages", async () => {
    vi.mocked(headers).mockResolvedValueOnce({
      get: vi.fn((name: string) => {
        if (name === "x-nonce") return "nonce-123";
        if (name === "x-csrf-token") return "a".repeat(64);
        if (name === "x-current-pathname") return "/register";
        return null;
      }),
    } as unknown as Awaited<ReturnType<typeof headers>>);

    const markup = renderToStaticMarkup(
      await RootLayout({
        children: <div id="page-content">Create your account</div>,
      })
    );

    const recoveryIndex = markup.indexOf("vmzAuthCacheReset");
    const pageIndex = markup.indexOf("Create your account");

    expect(recoveryIndex).toBeGreaterThan(-1);
    expect(recoveryIndex).toBeLessThan(pageIndex);
    expect(markup).toContain("serviceWorker");
    expect(markup).toContain("verifymzansi-");
  });
});
