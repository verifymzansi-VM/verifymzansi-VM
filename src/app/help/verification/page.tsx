import type { Metadata } from "next";
import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  FileText,
  MapPin,
  Monitor,
  Phone,
  Smartphone,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { InfoHero, SectionHeading } from "@/components/safety/info-hero";
import { Button } from "@/components/ui/button";
import { SUPPORT_CONTACT_EMAIL } from "@/lib/contact-email";

export const metadata: Metadata = {
  title: "Verification Help",
  description: "Common reasons for verification rejection and how to fix them on VerifyMzansi.",
};

/* ------------------------------------------------------------------ */
/*  Rejection explanations (mirrors REJECTION_GUIDANCE in verification */
/*  page but with extended detail and tips)                            */
/* ------------------------------------------------------------------ */

interface RejectionEntry {
  code: string;
  title: string;
  description: string;
  tips: string[];
}

const REJECTIONS: RejectionEntry[] = [
  {
    code: "blurry_image",
    title: "Blurry image",
    description: "Image too blurry to read. Clear text is required for verification.",
    tips: [
      "Use natural daylight or a well-lit room — avoid flash.",
      "Hold your device steady; rest your elbows on a table if possible.",
      "Make sure the camera focuses before capturing.",
    ],
  },
  {
    code: "mismatch",
    title: "Details don't match",
    description: "Name or ID number doesn't match your registration details.",
    tips: [
      "Check that your full legal name matches the document exactly.",
      "Verify your 13-digit SA ID number — one digit off causes a mismatch.",
      "If you changed your name, upload the updated document.",
    ],
  },
  {
    code: "expired_document",
    title: "Expired document",
    description: "Document is past its expiry date.",
    tips: [
      "Apply for a renewal at your nearest Home Affairs office.",
      "Use your SA Smart ID card, green ID book, or passport — whichever is still valid.",
    ],
  },
  {
    code: "incomplete_info",
    title: "Incomplete or cut-off document",
    description: "Part of the document is missing or cut off in the photo.",
    tips: [
      "Photograph the entire document from corner to corner.",
      "Place it on a flat, contrasting surface.",
      "Avoid cropping the image before uploading.",
    ],
  },
  {
    code: "wrong_document_type",
    title: "Wrong document type",
    description: "Uploaded file isn't a recognised SA identity document.",
    tips: [
      "We accept: SA Smart ID Card, SA Green ID Book, or SA Passport.",
      "Driver's licences and bank statements are not accepted.",
    ],
  },
  {
    code: "not_sa_document",
    title: "Non-South-African document",
    description: "Only SA identity documents are accepted.",
    tips: [
      "Upload your SA ID book, SA Smart ID card, or SA passport.",
      "Foreign passports and permits are not supported.",
    ],
  },
  {
    code: "insufficient_face_visibility",
    title: "Face not clearly visible (selfie)",
    description: "Selfie didn't show your face clearly enough.",
    tips: [
      "Face the camera directly — avoid angles.",
      "Remove sunglasses, hats, and anything covering your face.",
      "Use good lighting with even illumination.",
    ],
  },
  {
    code: "location_mismatch",
    title: "Location mismatch",
    description: "GPS coordinates don't match your selected province.",
    tips: [
      "Enable location services before verifying.",
      "Make sure you're in the province you selected.",
      "If you moved, update your province selection.",
    ],
  },
  {
    code: "high_risk_override",
    title: "Flagged for additional review",
    description: "Flagged for closer inspection. Not necessarily a rejection — admin will review.",
    tips: [
      "No action needed from you right now.",
      "Wait for admin review, typically 1-2 business days.",
      "You'll receive a notification once complete.",
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Verification steps overview                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    icon: Phone,
    name: "Phone number",
    description: "A one-time code to your SA mobile number.",
  },
  {
    icon: FileText,
    name: "Identity document",
    description: "A clear photo of your Smart ID, green ID book or passport.",
  },
  {
    icon: Camera,
    name: "Selfie",
    description: "A live selfie we match to your ID photo.",
  },
  {
    icon: MapPin,
    name: "Location",
    description: "GPS, or pick your province and town.",
  },
];

const CAMERA_HELP = [
  {
    icon: Monitor,
    title: "On a computer",
    subtitle: "Chrome, Edge, Firefox, Safari",
    tips: [
      "Open the lock icon next to the address bar and set Camera to Allow for this site.",
      "If Camera was previously set to Block, Chrome may stop showing a new prompt until you reset permission to Ask or Allow in site settings.",
      "Refresh the page and press Open Camera again.",
      "If no prompt appears, close other apps or tabs using your camera and retry.",
    ],
  },
  {
    icon: Smartphone,
    title: "On a phone",
    subtitle: "Android and iPhone",
    tips: [
      "Make sure browser camera permission is enabled in your phone Settings.",
      "On iPhone Safari: Settings > Safari > Camera > Allow.",
      "On Android Chrome: Site settings > Camera > Allow for this site.",
      "If you tapped Block before, Chrome will not re-prompt until you change this site back to Ask or Allow.",
      "If the prompt still does not appear, restart the browser and try again.",
    ],
  },
] as const;

export default function VerificationHelpPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <InfoHero
          title="Verification Help"
          description="Fix common verification issues quickly."
          breadcrumbs={[{ label: "Verification", href: "/verification" }, { label: "Help" }]}
          actions={
            <Button asChild variant="trust-verified" size="lg">
              <Link href="/verification">Continue verification</Link>
            </Button>
          }
        />

        <div className="container-page max-w-4xl space-y-14 py-10 sm:py-14">
          {/* ---------- Steps overview ---------- */}
          <section aria-labelledby="steps-title">
            <SectionHeading
              id="steps-title"
              title="The four verification steps"
              lede="Have your SA ID or passport ready."
            />
            <ol className="mt-6 grid gap-3 sm:grid-cols-2">
              {STEPS.map((step, index) => (
                <li key={step.name} className="surface-card flex gap-4 p-5">
                  <span className="icon-tile area-market-tile">
                    <step.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-brand-green-700 dark:text-brand-green-300">
                      Step {index + 1}
                    </p>
                    <h3 className="font-body text-base font-semibold text-foreground">
                      {step.name}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ---------- Camera troubleshooting ---------- */}
          <section aria-labelledby="camera-title">
            <SectionHeading
              id="camera-title"
              title="Camera not opening?"
              lede="Allow camera access in your browser."
            />
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {CAMERA_HELP.map((group) => (
                <div key={group.title} className="surface-card p-5">
                  <div className="flex items-center gap-3">
                    <span className="icon-tile bg-muted text-foreground/80">
                      <group.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="font-body text-base font-semibold text-foreground">
                        {group.title}
                      </h3>
                      <p className="text-xs text-muted-foreground">{group.subtitle}</p>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {group.tips.map((tip) => (
                      <li key={tip} className="flex gap-2.5 text-sm leading-6 text-foreground/85">
                        <span
                          aria-hidden="true"
                          className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green-600 dark:bg-brand-green-400"
                        />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded-2xl bg-muted/70 px-4 py-3 text-sm leading-6 text-muted-foreground">
              You can always continue verification by uploading a clear image file instead of using
              the live camera.
            </p>
          </section>

          {/* ---------- Rejection reasons ---------- */}
          <section aria-labelledby="rejections-title">
            <SectionHeading
              id="rejections-title"
              title="Common rejection reasons"
              lede="Find your reason and follow the tips."
            />
            <div className="mt-6 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-card elev-xs">
              {REJECTIONS.map((entry) => (
                <details key={entry.code} className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    {entry.title}
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="px-5 pb-5">
                    <p className="text-sm leading-6 text-muted-foreground">{entry.description}</p>
                    <ul className="mt-3 space-y-2">
                      {entry.tips.map((tip) => (
                        <li key={tip} className="flex gap-2.5 text-sm leading-6 text-foreground/85">
                          <CheckCircle2
                            className="mt-1 h-4 w-4 shrink-0 text-brand-green-700 dark:text-brand-green-300"
                            aria-hidden="true"
                          />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              ))}
            </div>
          </section>

          {/* ---------- Still stuck? ---------- */}
          <section
            aria-labelledby="stuck-title"
            className="hero-panel flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"
          >
            <div>
              <h2 id="stuck-title" className="font-display text-xl font-bold tracking-tight">
                Still having trouble?
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Email{" "}
                <a
                  href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
                  className="font-semibold text-brand-green-700 underline underline-offset-4 dark:text-brand-green-300"
                >
                  {SUPPORT_CONTACT_EMAIL}
                </a>{" "}
                and include your registered phone number.
              </p>
            </div>
            <Button asChild variant="outline" size="lg" className="shrink-0">
              <Link href="/contact?topic=verification_appeal">Appeal a decision</Link>
            </Button>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
