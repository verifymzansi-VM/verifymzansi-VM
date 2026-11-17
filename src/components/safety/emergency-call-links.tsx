import { Phone } from "lucide-react";

/** The "Call SAPS 10111" and "Call 112" buttons of the safety pages' emergency band. */
export function EmergencyCallLinks() {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row">
      <a
        href="tel:10111"
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-red-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Phone className="h-4 w-4" aria-hidden="true" />
        Call SAPS 10111
      </a>
      <a
        href="tel:112"
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-brand-red/30 bg-card px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Phone className="h-4 w-4" aria-hidden="true" />
        Call 112
      </a>
    </div>
  );
}
