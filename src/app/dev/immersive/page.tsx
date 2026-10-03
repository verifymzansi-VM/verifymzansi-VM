import { notFound } from "next/navigation";
import { buildFixtureSlides } from "./fixtures";
import { ImmersivePreview } from "./preview";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

/** Local design preview of the desktop post viewer (404 in production; see proxy-handler). */
export default function ImmersivePreviewPage() {
  if (process.env.NODE_ENV === "production" && !isPlaywrightTestMode()) notFound();
  return <ImmersivePreview slides={buildFixtureSlides()} />;
}
