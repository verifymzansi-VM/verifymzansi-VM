import path from "node:path";

export const POSTING_AUTH_DIR = path.join(process.cwd(), "e2e", ".auth");
export const POSTING_CHROMIUM_STATE = path.join(POSTING_AUTH_DIR, "posting-chromium.json");
export const POSTING_MOBILE_STATE = path.join(POSTING_AUTH_DIR, "posting-mobile.json");
