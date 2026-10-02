/**
 * Crawlers, link previewers and headless browsers. Search engines run page
 * JavaScript, so without this they would add visits and views (the IAB calls
 * this "general invalid traffic" and excludes it from counts). Edge-safe: the
 * middleware uses it too. "Cubot" is a phone brand, not a crawler.
 */
const AUTOMATED_AGENT =
  /(?<!cu)bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|whatsapp|telegrambot|discordbot|embedly|preview|lighthouse|pagespeed|headlesschrome|phantomjs|puppeteer|playwright|selenium|python-requests|curl\/|wget\/|go-http-client|axios\/|node-fetch|okhttp/i;

export function isAutomatedUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 8) return true;
  return AUTOMATED_AGENT.test(userAgent);
}
