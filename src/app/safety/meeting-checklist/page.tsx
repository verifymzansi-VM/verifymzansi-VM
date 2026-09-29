import Link from "next/link";
import { Phone, TriangleAlert } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { InfoHero } from "@/components/safety/info-hero";
import { MeetingChecklist } from "./meeting-checklist";

export const metadata = {
  title: "Meeting safety checklist",
  description:
    "Your checklist for safe in-person meetups when buying or selling on VerifyMzansi. Stay safe in South Africa.",
};

export default function MeetingChecklistPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <InfoHero
          title="Meeting safety checklist"
          description="Stay safe when meeting buyers or sellers."
          breadcrumbs={[{ label: "Safety", href: "/safety" }, { label: "Meeting Checklist" }]}
        />

        <div className="container-page space-y-8 py-8 sm:py-12">
          <MeetingChecklist />

          <section
            aria-labelledby="emergency-title"
            className="rounded-3xl border border-brand-red/25 bg-brand-red-50 p-5 dark:border-brand-red/30 dark:bg-brand-red-950/30 sm:p-7"
          >
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="flex items-start gap-4">
                <span className="icon-tile bg-brand-red/15 text-brand-red-700 dark:text-brand-red-300">
                  <TriangleAlert className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h2
                    id="emergency-title"
                    className="font-display text-lg font-bold text-foreground sm:text-xl"
                  >
                    Feel unsafe? Call for help.
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-foreground/80">
                    Then{" "}
                    <Link
                      href="/contact?topic=fraud_report"
                      className="font-semibold text-brand-red-700 underline underline-offset-4 dark:text-brand-red-300"
                    >
                      report the account to us
                    </Link>
                    .
                  </p>
                </div>
              </div>
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
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
