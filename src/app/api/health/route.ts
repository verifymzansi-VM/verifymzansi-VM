import { NextResponse } from "next/server";
import { getLaunchHealthSnapshot } from "@/lib/health/launch-health";

// No explicit `runtime = "edge"` needed — the entire app runs on Cloudflare
// Workers (edge) via @opennextjs/cloudflare. Declaring it here would disable
// static generation and trigger a build warning.

export async function GET() {
  const snapshot = await getLaunchHealthSnapshot();

  return NextResponse.json(snapshot, {
    status: snapshot.status === "ok" ? 200 : 503,
  });
}
