import type { Metadata } from "next";
import Link from "next/link";
import {
  Camera,
  FileText,
  MapPin,
  Phone,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Verification Help | VerifyMzansi",
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
    title: "Blurry Image",
    description: "Image too blurry to read. Clear text is required for verification.",
    tips: [
      "Use natural daylight or a well-lit room — avoid flash.",
      "Hold your device steady; rest your elbows on a table if possible.",
      "Make sure the camera focuses before capturing.",
    ],
  },
  {
    code: "mismatch",
    title: "Details Don't Match",
    description: "Name or ID number doesn't match your registration details.",
    tips: [
      "Check that your full legal name matches the document exactly.",
      "Verify your 13-digit SA ID number — one digit off causes a mismatch.",
      "If you changed your name, upload the updated document.",
    ],
  },
  {
    code: "expired_document",
    title: "Expired Document",
    description: "Document is past its expiry date.",
    tips: [
      "Apply for a renewal at your nearest Home Affairs office.",
      "Use your SA Smart ID card, green ID book, or passport — whichever is still valid.",
    ],
  },
  {
    code: "incomplete_info",
    title: "Incomplete / Cut-off Document",
    description: "Part of the document is missing or cut off in the photo.",
    tips: [
      "Photograph the entire document from corner to corner.",
      "Place it on a flat, contrasting surface.",
      "Avoid cropping the image before uploading.",
    ],
  },
  {
    code: "wrong_document_type",
    title: "Wrong Document Type",
    description: "Uploaded file isn't a recognised SA identity document.",
    tips: [
      "We accept: SA Smart ID Card, SA Green ID Book, or SA Passport.",
      "Driver's licences and bank statements are not accepted.",
    ],
  },
  {
    code: "not_sa_document",
    title: "Non-South-African Document",
    description: "Only SA identity documents are accepted.",
    tips: [
      "Upload your SA ID book, SA Smart ID card, or SA passport.",
      "Foreign passports and permits are not supported.",
    ],
  },
  {
    code: "insufficient_face_visibility",
    title: "Face Not Clearly Visible (Selfie)",
    description: "Selfie didn't show your face clearly enough.",
    tips: [
      "Face the camera directly — avoid angles.",
      "Remove sunglasses, hats, and anything covering your face.",
      "Use good lighting with even illumination.",
    ],
  },
  {
    code: "location_mismatch",
    title: "Location Mismatch",
    description: "GPS coordinates don't match your selected province.",
    tips: [
      "Enable location services before verifying.",
      "Make sure you're in the province you selected.",
      "If you moved, update your province selection.",
    ],
  },
  {
    code: "high_risk_override",
    title: "Flagged for Additional Review",
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
    name: "Phone Verification",
    description: "We send an OTP to your South African mobile number to confirm you own it.",
  },
  {
    icon: FileText,
    name: "Identity Document",
    description: "Upload a clear photo of your SA Smart ID card, green ID book, or passport.",
  },
  {
    icon: Camera,
    name: "Selfie",
    description: "Take a live selfie so we can match your face to the photo on your ID document.",
  },
  {
    icon: MapPin,
    name: "Location",
    description: "Confirm your location via GPS or manually select your province and town.",
  },
];

export default function VerificationHelpPage() {
  return (
    <div className="container-page max-w-3xl py-10">
      <Link
        href="/verification"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Verification
      </Link>

      <h1 className="text-2xl font-bold tracking-tight mb-2">Verification Help</h1>
      <p className="text-muted-foreground mb-8">
        Understand the verification process and learn how to fix common issues.
      </p>

      {/* ---------- Steps overview ---------- */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-brand-green" />
          The 4 Verification Steps
        </h2>
        <div className="grid gap-3">
          {STEPS.map((step) => (
            <div key={step.name} className="flex items-start gap-3 rounded-lg border p-3">
              <step.icon className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">{step.name}</p>
                <p className="text-xs sm:text-sm text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Rejection reasons ---------- */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Common Rejection Reasons &amp; How to Fix Them
        </h2>
        <div className="space-y-4">
          {REJECTIONS.map((entry) => (
            <details
              key={entry.code}
              className="group rounded-lg border open:ring-1 open:ring-brand-green/20"
            >
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium hover:bg-muted/50 rounded-lg">
                {entry.title}
              </summary>
              <div className="px-4 pb-4 pt-1">
                <p className="text-sm text-muted-foreground mb-2">{entry.description}</p>
                <ul className="list-disc list-inside space-y-1">
                  {entry.tips.map((tip) => (
                    <li key={tip} className="text-xs sm:text-sm text-muted-foreground">
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
      <section className="mt-10 rounded-lg border bg-muted/30 p-4 text-center">
        <p className="text-sm font-medium mb-1">Still having trouble?</p>
        <p className="text-xs text-muted-foreground">
          Contact us at{" "}
          <a href="mailto:support@verifymzansi.co.za" className="underline">
            support@verifymzansi.co.za
          </a>{" "}
          and include your registered phone number.
        </p>
      </section>
    </div>
  );
}
