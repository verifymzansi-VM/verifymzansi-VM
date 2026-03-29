import { NextResponse, type NextRequest } from "next/server";
import { ensureCsrfCookie, generateCsrfToken } from "@/lib/utils/csrf";

export async function GET(request: NextRequest) {
  const token =
    request.cookies.get("vm_csrf")?.value &&
    /^[a-f0-9]{64}$/i.test(request.cookies.get("vm_csrf")!.value)
      ? request.cookies.get("vm_csrf")!.value
      : generateCsrfToken();
  const response = NextResponse.json(
    { token },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
      },
    }
  );
  ensureCsrfCookie(request, response, token);
  return response;
}
