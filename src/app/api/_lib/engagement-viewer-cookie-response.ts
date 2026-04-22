import { NextResponse } from "next/server";

import {
  ENGAGEMENT_VIEWER_COOKIE,
  ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/engagement";

export function createViewerCookieJsonResponse(
  payload: unknown,
  existingViewerId: string | null,
  nextViewerId: string
) {
  const response = NextResponse.json(payload);

  if (!existingViewerId) {
    response.cookies.set({
      name: ENGAGEMENT_VIEWER_COOKIE,
      value: nextViewerId,
      maxAge: ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  return response;
}
