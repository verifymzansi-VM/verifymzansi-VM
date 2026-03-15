import { NextResponse, type NextRequest } from "next/server";
import { listPlaywrightTableRows } from "@/lib/supabase/playwright-fixture-store";
import { isPlaywrightSupabaseStubMode, isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

function ensureEnabled() {
  return isPlaywrightTestMode() && isPlaywrightSupabaseStubMode();
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ensureEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const listing = listPlaywrightTableRows("listings").find((row) => row.id === id) ?? null;

  return NextResponse.json({ data: listing, error: null });
}
