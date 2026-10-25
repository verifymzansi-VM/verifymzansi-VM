import { timingSafeEqual } from "./timing-safe-equal";

/** The schedule and authenticated manual trigger run the same job path. */
export async function runAuthorizedWorkerTrigger(
  request: Request,
  key: string | undefined,
  run: () => Promise<void>
) {
  const expected = key ? `Bearer ${key}` : "";
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!expected || !timingSafeEqual(request.headers.get("Authorization") ?? "", expected))
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  await run();
  return new Response(JSON.stringify({ triggered: true }), { headers });
}
