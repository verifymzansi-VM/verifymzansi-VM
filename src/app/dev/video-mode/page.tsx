import { notFound } from "next/navigation";
import { buildFixtureSlides } from "../immersive/fixtures";
import { VideoModePreview } from "./preview";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

/** Local demo of mobile Video mode with fixture posts (404 in production; see proxy-handler). */
export default function VideoModePreviewPage() {
  if (process.env.NODE_ENV === "production" && !isPlaywrightTestMode()) notFound();
  return <VideoModePreview slides={buildFixtureSlides()} />;
}
