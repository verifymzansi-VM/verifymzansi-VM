import { test, expect, type Page } from "@playwright/test";

// The server render must already match the visitor's session so the header
// does not paint signed-out and then swap (wordmark hidden, bell added).
function headerHtml(html: string): string {
  const start = html.indexOf("<header");
  return start >= 0 ? html.slice(start, html.indexOf("</header>", start)) : "";
}

async function serverHeader(page: Page): Promise<string> {
  const response = await page.request.get("/");
  expect(response.ok()).toBeTruthy();
  return headerHtml(await response.text());
}

test.describe("Header session shell", () => {
  test("renders the signed-out header for anonymous visitors", async ({ page }) => {
    const header = await serverHeader(page);
    expect(header).toContain("Sign in");
  });

  test("renders the signed-in header on the first paint for a session", async ({ page }) => {
    const signIn = await page.goto("/api/e2e/auth/session?persona=header-shell&reset=1", {
      waitUntil: "networkidle",
    });
    expect(signIn?.ok()).toBeTruthy();

    const header = await serverHeader(page);
    expect(header).not.toContain("Sign in");
    expect(header).toContain('aria-label="Account menu"');
  });
});
