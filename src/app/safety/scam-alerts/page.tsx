import {
  ShieldAlert,
  AlertTriangle,
  Phone,
  MapPin,
  CreditCard,
  Eye,
  MessageSquare,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = {
  title: "Scam Alerts — Stay Safe | VerifyMzansi",
  description:
    "Learn how to spot and avoid scams on online marketplaces. Stay safe when buying and selling in South Africa.",
};

const SCAM_TYPES = [
  {
    icon: CreditCard,
    title: "Advance Payment Scams",
    description:
      "Never pay upfront deposits to someone you haven't met. Scammers ask for EFTs or e-wallet transfers before delivering goods.",
    tips: [
      "Pay only on delivery after inspecting the item",
      "Never transfer money to strangers via Capitec, FNB, or e-wallet",
      "Use PayFast or secure payment methods when available",
    ],
  },
  {
    icon: Phone,
    title: "Fake Seller Profiles",
    description:
      "Look for the VerifyMzansi trust badge. Unverified profiles may use stolen photos and fake identities.",
    tips: [
      "Check the seller's verification status and trust score",
      "Reverse-search profile photos with Google",
      "Ask questions only a real seller would know",
    ],
  },
  {
    icon: MapPin,
    title: "Location Bait",
    description:
      "Sellers who claim to be local but keep making excuses not to meet in person may be running a scam from another location.",
    tips: [
      "Insist on meeting face-to-face in a public place",
      "Use our Meeting Safety Checklist",
      "Be wary of sellers who refuse video calls",
    ],
  },
  {
    icon: Eye,
    title: "Too Good To Be True",
    description:
      "Unusually low prices on phones, cars, or electronics are a classic red flag. If the deal seems too good, it probably is.",
    tips: [
      "Compare prices across multiple listings",
      "Be suspicious of prices 50%+ below market value",
      "Check how long the seller has been on the platform",
    ],
  },
  {
    icon: MessageSquare,
    title: "Off-Platform Communication",
    description:
      "Scammers often ask you to move to WhatsApp, Telegram, or email quickly to avoid platform protections.",
    tips: [
      "Keep communication on VerifyMzansi as long as possible",
      "Report sellers who insist on off-platform deals",
      "Screenshot conversations as evidence",
    ],
  },
];

export default function ScamAlertsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <div className="container-page py-6 space-y-8">
          <PageHeader
            title="Scam Alerts"
            description="Stay informed about common scams and learn how to protect yourself when buying and selling online in South Africa."
            breadcrumbs={[{ label: "Safety" }, { label: "Scam Alerts" }]}
          />

          {/* Warning Banner */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-200">
                If you&apos;ve been scammed
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Report it to the South African Police Service (SAPS) and file a report on
                VerifyMzansi. Keep all evidence including screenshots, messages, and payment
                receipts.
              </p>
            </div>
          </div>

          {/* Scam Types */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {SCAM_TYPES.map((scam) => {
              const Icon = scam.icon;
              return (
                <Card key={scam.title}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-destructive/10 p-2">
                        <Icon className="h-5 w-5 text-destructive" />
                      </div>
                      <CardTitle className="text-lg">{scam.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">{scam.description}</p>
                    <ul className="space-y-1">
                      {scam.tips.map((tip) => (
                        <li key={tip} className="text-sm flex items-start gap-2">
                          <ShieldAlert className="h-3 w-3 mt-1 text-brand-green flex-shrink-0" />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Quick Tips */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge className="bg-brand-green text-white">Golden Rules</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 list-decimal list-inside text-sm text-muted-foreground">
                <li>Always deal with verified sellers (look for the green shield)</li>
                <li>Never pay before you see and inspect the item</li>
                <li>Meet in public, well-lit places — never at home</li>
                <li>Tell a friend or family member where you&apos;re going</li>
                <li>If something feels off, trust your gut and walk away</li>
                <li>Report suspicious listings immediately</li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}
