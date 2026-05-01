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

const safetyRules = [
  "Never pay deposits before seeing goods and confirming ownership.",
  "Meet in safe, public, well-lit places. Avoid private locations for first meetings.",
  "Do not share OTPs, banking details, ID documents, or card information in chats.",
  "Be careful with courier, EFT, e-wallet, fake proof-of-payment, and pressure tactics.",
  "Keep screenshots, listing links, payment references, and courier details.",
] as const;

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

          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold text-amber-900 dark:text-amber-100">
                  Verification reduces risk. It does not remove the need for safe trading.
                </h2>
                <p className="text-sm text-amber-800 dark:text-amber-200">
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
                  <div key={step.title} className="rounded-md border bg-background p-3">
                    <h3 className="text-sm font-semibold">{step.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Link
              href="/safety/scam-alerts"
              className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold">Scam Alerts</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Learn common marketplace scam patterns and warning signs.
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            </Link>

            <Link
              href="/safety/meeting-checklist"
              className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold">Meeting Safety</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Use a simple checklist before meeting someone from a listing.
                  </p>
                </div>
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            </Link>
          </section>

          <section className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              <Gavel className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
              <div className="space-y-1">
                <h2 className="font-display text-base font-semibold">
                  Criminal matters should be reported to SAPS.
                </h2>
                <p className="text-sm text-muted-foreground">
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
