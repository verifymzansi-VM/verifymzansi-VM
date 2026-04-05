import {
  ShieldAlert,
  AlertTriangle,
  Phone,
  MapPin,
  CreditCard,
  Eye,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = {
  title: "Scam Alerts",
  description:
    "Learn how to spot and avoid scams on online marketplaces. Stay safe when buying and selling in South Africa.",
};

const SCAM_TYPES = [
  {
    icon: CreditCard,
    title: "Advance Payment Scams",
    description: "Never pay upfront deposits before inspecting goods in person.",
    tips: [
      "Pay only on delivery after inspecting the item",
      "Never transfer money to strangers via EFT or e-wallet",
      "Use Ozow or secure payment methods",
    ],
  },
  {
    icon: Phone,
    title: "Fake Account Profiles",
    description:
      "Look for the VerifyMzansi trust badge. Unverified profiles may use stolen photos.",
    tips: [
      "Check the account's verification status",
      "Reverse-search profile photos",
      "Ask questions only a real owner would know",
    ],
  },
  {
    icon: MapPin,
    title: "Location Bait",
    description: "People who keep making excuses not to meet may be running a scam.",
    tips: [
      "Insist on meeting face-to-face in public",
      "Use our Meeting Safety Checklist",
      "Be wary of people who refuse video calls",
    ],
  },
  {
    icon: Eye,
    title: "Too Good To Be True",
    description: "Unusually low prices on phones, cars, or electronics are a classic red flag.",
    tips: [
      "Compare prices across multiple listings",
      "Be suspicious of prices 50%+ below market value",
      "Check how long the account has been on the platform",
    ],
  },
  {
    icon: MessageSquare,
    title: "Off-Platform Communication",
    description:
      "Scammers often ask to move to WhatsApp or Telegram to avoid platform protections.",
    tips: [
      "Keep communication on VerifyMzansi",
      "Report accounts insisting on off-platform deals — use our contact form",
      "Screenshot conversations as evidence",
    ],
  },
];

export default function ScamAlertsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <div className="container-page py-4 space-y-4">
          <PageHeader
            title="Scam Alerts"
            description="Protect yourself when buying and selling online."
            breadcrumbs={[{ label: "Safety" }, { label: "Scam Alerts" }]}
          />

          {/* Warning Banner */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-sm text-amber-800 dark:text-amber-200">
                If you&apos;ve been scammed
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Report to SAPS and file a report on VerifyMzansi. Keep all evidence.
              </p>
            </div>
          </div>

          {/* Scam Types */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {SCAM_TYPES.map((scam) => {
              const Icon = scam.icon;
              return (
                <Card key={scam.title} className="p-0">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <div className="rounded-md bg-destructive/10 p-1.5">
                        <Icon className="h-4 w-4 text-destructive" />
                      </div>
                      <CardTitle className="text-sm">{scam.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    <p className="text-xs sm:text-sm text-muted-foreground">{scam.description}</p>
                    <ul className="space-y-0.5">
                      {scam.tips.map((tip) => (
                        <li key={tip} className="text-xs sm:text-sm flex items-start gap-1.5">
                          <ShieldAlert className="h-3 w-3 mt-0.5 text-brand-green flex-shrink-0" />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Golden Rules - inline */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-semibold mb-1.5 flex items-center gap-1.5">
              <Badge className="bg-brand-green text-white text-[10px] px-1.5 py-0">
                Golden Rules
              </Badge>
            </p>
            <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 list-decimal list-inside text-xs sm:text-sm text-muted-foreground">
              <li>Always deal with verified accounts, businesses, or advertisers (green shield)</li>
              <li>Never pay before inspecting the item</li>
              <li>Meet in public, well-lit places</li>
              <li>Tell someone where you&apos;re going</li>
              <li>Trust your gut — walk away if unsure</li>
              <li>
                Report suspicious listings immediately —{" "}
                <Link
                  href="/contact"
                  className="text-brand-green underline hover:text-brand-green/80"
                >
                  report here
                </Link>
              </li>
            </ol>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
