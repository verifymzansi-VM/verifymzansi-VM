import fs from "node:fs/promises";
import { chromium, devices, type FullConfig } from "@playwright/test";
import { POSTING_AUTH_DIR, POSTING_CHROMIUM_STATE, POSTING_MOBILE_STATE } from "./auth-state";

async function createStorageState(
  baseURL: string,
  storagePath: string,
  persona: string,
  mobile = false
) {
  const browser = await chromium.launch();
  const context = await browser.newContext(mobile ? devices["Pixel 7"] : undefined);
  const page = await context.newPage();

  await page.goto(`${baseURL}/api/e2e/auth/session?persona=${persona}&reset=1`, {
    waitUntil: "networkidle",
  });
  await context.storageState({ path: storagePath });
  await browser.close();
}

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    config.projects.find((project) => project.name === "chromium")?.use.baseURL ||
    config.projects[0]?.use.baseURL ||
    "http://127.0.0.1:3100";

  await fs.mkdir(POSTING_AUTH_DIR, { recursive: true });
  await createStorageState(baseURL, POSTING_CHROMIUM_STATE, "posting-chromium");
  await createStorageState(baseURL, POSTING_MOBILE_STATE, "posting-mobile", true);
}
