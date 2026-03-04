import {
  CheckCircle2,
  MapPin,
  Users,
  Clock,
  Phone,
  Shield,
  Car,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = {
  title: "Meeting Safety Checklist",
  description:
    "Your checklist for safe in-person meetups when buying or selling on VerifyMzansi. Stay safe in South Africa.",
};

const BEFORE_MEETING = [
  {
    icon: Shield,
    text: "Verify the seller's VerifyMzansi trust badge and profile",
  },
  {
    icon: Phone,
    text: "Have a phone or video call before meeting to confirm identity",
  },
  {
    icon: Users,
    text: "Tell a friend or family member where you're going & share your live location",
  },
  {
    icon: Clock,
    text: "Schedule the meeting during daylight hours",
  },
  {
    icon: MapPin,
    text: "Choose a public, busy location — a mall, police station, or petrol station",
  },
  {
    icon: Car,
    text: "Drive yourself or use your own transport — don't get into the other person's car",
  },
];

const DURING_MEETING = [
  "Meet in the open, not inside a car or private space",
  "Inspect the item thoroughly before any payment",
  "If buying, count the money privately before handing it over",
  "If selling electronics, factory-reset devices in front of the buyer",
  "Keep your phone fully charged and accessible",
  "Trust your gut — if something feels wrong, leave",
];

const AFTER_MEETING = [
  "Leave the meeting point before counting your money again",
  "Send a confirmation message to your friend/family that you're safe",
  "Rate the buyer/seller on VerifyMzansi to help the community",
  "Report any suspicious behaviour to VerifyMzansi and SAPS if needed",
];

export default function MeetingChecklistPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <div className="container-page py-6 space-y-6">
          <PageHeader
            title="Meeting Safety Checklist"
            description="Use this checklist every time you meet someone in person for a buy or sell. Your safety comes first."
            breadcrumbs={[{ label: "Safety" }, { label: "Meeting Checklist" }]}
          />

          {/* Reminder Banner */}
          <div className="rounded-lg border border-brand-green/30 bg-brand-green-50 dark:bg-brand-green-950/30 p-4 flex items-start gap-3">
            <Shield className="h-5 w-5 text-brand-green mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-brand-green-800 dark:text-brand-green-200">
                Safety First
              </p>
              <p className="text-sm text-brand-green-700 dark:text-brand-green-300 mt-1">
                VerifyMzansi verifies sellers, but always follow safe practices when meeting someone
                in person. No item is worth your safety.
              </p>
            </div>
          </div>

          {/* Before Meeting */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge className="bg-brand-gold text-amber-950">Before You Meet</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {BEFORE_MEETING.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.text} className="flex items-start gap-3">
                      <div className="rounded-lg bg-muted p-2 flex-shrink-0">
                        <Icon className="h-4 w-4 text-brand-green" />
                      </div>
                      <p className="text-sm">{item.text}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* During Meeting */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge className="bg-brand-green text-white">During the Meetup</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {DURING_MEETING.map((tip) => (
                  <li key={tip} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-brand-green flex-shrink-0" />
                    {tip}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* After Meeting */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant="secondary">After the Meetup</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {AFTER_MEETING.map((tip) => (
                  <li key={tip} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    {tip}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Emergency */}
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-destructive">Emergency</p>
              <p className="text-sm text-muted-foreground mt-1">
                If you feel unsafe during a meetup, call <strong>10111</strong> (SAPS) or{" "}
                <strong>112</strong> (from a cellphone) immediately. Your safety always comes first.
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
