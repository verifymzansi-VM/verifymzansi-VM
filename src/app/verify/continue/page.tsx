import type { Metadata } from "next";
import { ContinueCapture } from "./continue-capture";

export const metadata: Metadata = {
  title: "Continue your ID check",
  description: "Take your ID photos on this phone for a check started on your computer.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** The page a "Continue on your phone" QR code opens: photos only, nothing else. */
export default function ContinueCapturePage() {
  return <ContinueCapture />;
}
