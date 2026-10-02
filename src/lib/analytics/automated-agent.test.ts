import { describe, expect, it } from "vitest";
import { isAutomatedUserAgent } from "./automated-agent";

describe("isAutomatedUserAgent", () => {
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "facebookexternalhit/1.1",
    "WhatsApp/2.23.20.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0 Safari/537.36",
    "curl/8.4.0",
    "",
  ])("treats %s as automated", (agent) => {
    expect(isAutomatedUserAgent(agent)).toBe(true);
  });

  it.each([
    "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; SM-A156E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 [FBAN/EMA;FBLC/en_GB]",
  ])("counts real phones and browsers: %s", (agent) => {
    expect(isAutomatedUserAgent(agent)).toBe(false);
  });
});
