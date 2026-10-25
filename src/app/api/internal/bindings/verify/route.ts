import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hasRuntimeDiagnosticAccess, verifyRuntimeBindings } from "@/lib/health/runtime-bindings";
import { parseJsonRequest } from "@/lib/utils/api";

const headers = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
};
export async function POST(request: Request) {
  let environment: Readonly<Record<string, unknown>>;
  try {
    environment = (await getCloudflareContext({ async: true })).env as unknown as Record<
      string,
      unknown
    >;
  } catch {
    return NextResponse.json(
      { error: "Runtime diagnostics unavailable" },
      { status: 503, headers }
    );
  }
  if (
    !hasRuntimeDiagnosticAccess(
      request.headers.get("authorization"),
      environment.HEALTH_DIAGNOSTIC_TOKEN
    )
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const result = verifyRuntimeBindings(
      environment,
      await parseJsonRequest(request, { maxBytes: 8192 })
    );
    // These direct references are inlined by Next.js. A matching runtime URL
    // alone cannot prove that the browser bundle was rebuilt for this project.
    const compiledPublic = {
      backend: process.env.NEXT_PUBLIC_DATA_BACKEND === "foundation",
      url: process.env.NEXT_PUBLIC_SUPABASE_URL === "https://gntzjtuncsyefujajmjy.supabase.co",
      publishable:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ===
        environment.FOUNDATION_SUPABASE_PUBLISHABLE_KEY,
    };
    const ok = result.ok && Object.values(compiledPublic).every(Boolean);
    return NextResponse.json(
      { ...result, ok, compiledPublic },
      { status: ok ? 200 : 503, headers }
    );
  } catch {
    return NextResponse.json({ error: "Invalid diagnostic request" }, { status: 400, headers });
  }
}
