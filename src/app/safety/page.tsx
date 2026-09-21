import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  FileWarning,
  Gavel,
  MapPin,
  ShieldAlert,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Safety Centre",
  description:
    "Buyer and seller safety guidance for VerifyMzansi users in South Africa, including scam warnings, safe meetings, disputes, reports, and appeals.",
};

import { SAFETY_RULES as safetyRules } from "@/lib/constants/safety-rules";

const responseSteps = [
  {
    title: "Report suspicious listings",
    description:
      "Use the contact form with listing links, screenshots, user handles, and payment references.",
  },
  {
    title: "Moderation review",
    description:
      "VerifyMzansi can review reports, remove fraudulent content, restrict accounts, and request more evidence.",
  },
  {
    title: "Appeals",
    description:
      "If a verification or moderation decision looks wrong, users should provide fresh evidence for review.",
  },
] as const;

export default function SafetyCentrePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <div className="container-page py-4 space-y-5">
          <PageHeader
            title="Safety Centre"
            description="Practical guidance for safer buying, selling, scam reports, and moderation."
            breadcrumbs={[{ label: "Safety Centre" }]}
          />

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 elev-xs dark:border-amber-900/60 dark:bg-amber-950/40">
            <div className="flex items-start gap-3.5">
              <span className="icon-tile bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold text-amber-900 dark:text-amber-100">
                  Verification reduces risk. It does not remove the need for safe trading.
                </h2>
                <p className="text-sm leading-6 text-amber-800 dark:text-amber-200">
                  Inspect goods, confirm details, avoid pressure, and walk away from unsafe deals.
                </p>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="h-4 w-4 text-brand-green" />
                  Buyer and seller rules
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {safetyRules.map((rule) => (
                    <li key={rule} className="flex gap-2">
                      <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileWarning className="h-4 w-4 text-brand-green" />
                  Reports, disputes, and appeals
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {responseSteps.map((step) => (
                  <div
                    key={step.title}
                    className="rounded-xl border border-border/60 bg-muted/40 p-3.5"
                  >
                    <h3 className="text-sm font-semibold">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Link
              href="/safety/scam-alerts"
              className="group surface-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:elev-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold">Scam Alerts</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Learn common marketplace scam patterns and warning signs.
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
              </div>
            </Link>

            <Link
              href="/safety/meeting-checklist"
              className="group surface-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:elev-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold">Meeting Safety</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Use a simple checklist before meeting someone from a listing.
                  </p>
                </div>
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              </div>
            </Link>
          </section>

          <section className="surface-card p-5">
            <div className="flex items-start gap-3.5">
              <span className="icon-tile bg-brand-green/10 text-brand-green dark:text-brand-green-300">
                <Gavel className="h-5 w-5" />
              </span>
              <div className="space-y-1">
                <h2 className="font-display text-base font-semibold">
                  Criminal matters should be reported to SAPS.
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  VerifyMzansi can moderate platform content, but cannot recover money, goods, or
                  identity documents.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
