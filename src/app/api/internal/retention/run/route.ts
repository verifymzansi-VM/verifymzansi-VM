import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runFoundationRetention } from "@/lib/foundation/retention-jobs";
export async function POST(request: Request) {
  const key = process.env.INTERNAL_JOBS_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") ?? ""),
    expected = Buffer.from(key ? `Bearer ${key}` : "");
  if (
    !key ||
    key.length < 32 ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runFoundationRetention(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Retention could not be completed" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
