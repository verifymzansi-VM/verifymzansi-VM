import { NextResponse } from "next/server";

export function rateLimitExceededResponse({
  degraded,
  retryAfter,
  degradedMessage,
  limitedMessage,
}: {
  degraded?: boolean;
  retryAfter?: number;
  degradedMessage: string;
  limitedMessage: string;
}) {
  if (degraded) {
    return NextResponse.json(
      { error: degradedMessage },
      { status: 503, headers: { "Retry-After": String(retryAfter ?? 60) } }
    );
  }

  return NextResponse.json(
    { error: limitedMessage },
    { status: 429, headers: { "Retry-After": String(retryAfter ?? 60) } }
  );
}
