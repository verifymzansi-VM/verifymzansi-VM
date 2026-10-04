import type { Metadata } from "next";
import { VideoModeLoader } from "./loader";
import { parseBrowse } from "@/lib/feed/browse";

export const metadata: Metadata = {
  title: "Video mode",
  description: "Browse VerifyMzansi posts one full-screen video or photo at a time.",
  robots: { index: false, follow: false },
};

/**
 * /video-mode?v=market&province=…: phones and tablets browse one post at a
 * time. Invalid filters fall back to the remembered section rather than an
 * error; desktops are sent to the matching list by the loader.
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

  return <VideoModeLoader browse={browse} />;
}
