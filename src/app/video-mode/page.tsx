import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VideoModeLoader } from "./loader";
import { ENGAGEMENT_VIEWER_COOKIE } from "@/lib/engagement";
import { parseBrowse } from "@/lib/feed/browse";
import { listHrefForBrowse } from "@/lib/feed/video-mode";
import { isVideoModeEnabled } from "@/lib/feed/video-mode-flag";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Video mode",
  description: "Browse VerifyMzansi posts one full-screen video or photo at a time.",
  robots: { index: false, follow: false },
};

/**
 * /video-mode?v=market&province=…: phones and tablets browse one post at a
 * time. Behind the `video_mode` flag; when it is off for this visitor the
 * address opens the matching list instead. Invalid filters fall back to the
 * remembered section rather than an error.
 */
export default async function VideoModePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") search.set(key, value);
  }
  const browse = search.has("v") ? parseBrowse(search) : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = (await cookies()).get(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null;
  if (!(await isVideoModeEnabled({ user, viewerId }))) {
    redirect(browse ? listHrefForBrowse(browse) : "/");
  }

  return <VideoModeLoader browse={browse} />;
}
