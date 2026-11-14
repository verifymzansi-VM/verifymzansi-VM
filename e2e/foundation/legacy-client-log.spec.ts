import { expect, test } from "@playwright/test";
import { readServerLogEntries, type ServerLogEntry } from "./support/test-copy";

// Roadmap M0.11: when code written for the retired backend creates one of the
// retired Supabase clients while the website runs foundation (as production
// does), the server writes one structured warning naming the route pattern and
// nothing else. The public Pricing page (/pricing) is such an old route: it
// creates the retired admin client to read the commercial settings, and falls
// back to the defaults when that read fails. (The like counter served here
// until roadmap M2.8 closed it, then the programme report download until it
// was hidden.) When this page moves to foundation, point this spec at another
// route that is still old.
const EVENT = "legacy_client_in_foundation";
const ROUTE = "/pricing";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const entriesFor = (route: string) =>
  readServerLogEntries(EVENT).filter((entry) => entry.meta?.route === route);

function expectNoPersonalData(entry: ServerLogEntry) {
  expect(entry).toEqual({
    timestamp: expect.any(String),
    level: "warn",
    context: "LegacyBackend",
    message: EVENT,
    meta: { route: expect.any(String), client: expect.stringMatching(/^(admin|server|public)$/) },
  });
  const route = String(entry.meta?.route);
  expect(route === "unknown" || /^\/[A-Za-z0-9/_\-.[\]()@]*$/.test(route)).toBe(true);
  const text = JSON.stringify(entry.meta);
  expect(text).not.toMatch(UUID);
  expect(text).not.toMatch(/[@?=%]/);
}

test("an old route in foundation mode logs legacy_client_in_foundation once, without personal data", async ({
  request,
  baseURL,
}) => {
  const before = entriesFor(ROUTE).length;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request.get("/pricing", { headers: { origin: String(baseURL) } });
    // The log line changes nothing: the page still renders for a visitor.
    expect(response.status()).toBe(200);
  }

  await expect.poll(() => entriesFor(ROUTE).length, { timeout: 10_000 }).toBeGreaterThan(0);
  // Three calls, at most one new entry: the line is deduplicated per route.
  expect(entriesFor(ROUTE).length - before).toBeLessThanOrEqual(1);
  for (const entry of entriesFor(ROUTE)) {
    expectNoPersonalData(entry);
    expect(entry.meta?.client).toBe("admin");
  }
  // No entry from any route this run carries anything but a route pattern.
  for (const entry of readServerLogEntries(EVENT)) expectNoPersonalData(entry);
});
