import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { EmergencyCallLinks } from "@/components/safety/emergency-call-links";
import { InfoHero } from "@/components/safety/info-hero";
import { MeetingChecklist } from "./meeting-checklist";

export const metadata = {
  title: "Meeting safety checklist",
  alternates: { canonical: "/safety/meeting-checklist" },
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
              <EmergencyCallLinks />
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
