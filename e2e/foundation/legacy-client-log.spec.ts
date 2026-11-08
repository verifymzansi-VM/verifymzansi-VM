import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { readServerLogEntries, type ServerLogEntry } from "./support/test-copy";

// Roadmap M0.11: when code written for the retired backend creates one of the
// retired Supabase clients while the website runs foundation (as production
// does), the server writes one structured warning naming the route pattern and
// nothing else. The like counter (/api/engagement/like) is such an old route:
// it calls a retired command through the retired admin client. When that route
// moves to foundation, point this spec at another route that is still old.
const EVENT = "legacy_client_in_foundation";
const ROUTE = "/api/engagement/like";
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
    const response = await request.post(ROUTE, {
      headers: { origin: String(baseURL) },
      data: { targetId: randomUUID(), targetType: "listing" },
    });
    // The log line changes nothing: the route still gives its own answer, which
    // on the copy (as live) is its failure to reach the retired backend.
    expect(response.status()).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to update like" });
  }

  await expect.poll(() => entriesFor(ROUTE).length, { timeout: 10_000 }).toBeGreaterThan(0);
  // Three calls, at most one new entry: the line is deduplicated per route.
  expect(entriesFor(ROUTE).length - before).toBeLessThanOrEqual(1);
  for (const entry of entriesFor(ROUTE)) {
    expectNoPersonalData(entry);
    expect(entry.meta?.client).toBe("server");
  }
  // No entry from any route this run carries anything but a route pattern.
  for (const entry of readServerLogEntries(EVENT)) expectNoPersonalData(entry);
});
