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
    text: "Verify the account's trust badge and profile",
  },
  {
    icon: Phone,
    text: "Have a phone/video call to confirm identity",
  },
  {
    icon: Users,
    text: "Tell someone where you're going & share live location",
  },
  {
    icon: Clock,
    text: "Schedule during daylight hours",
  },
  {
    icon: MapPin,
    text: "Choose a public location — mall, police station, petrol station",
  },
  {
    icon: Car,
    text: "Use your own transport",
  },
];

const DURING_MEETING = [
  "Meet in the open, not inside a car or private space",
  "Inspect the item thoroughly before payment",
  "Count money privately before handing it over",
  "Factory-reset devices in front of buyer",
  "Keep your phone charged and accessible",
  "Trust your gut — leave if something feels wrong",
];

const AFTER_MEETING = [
  "Leave before counting your money again",
  "Confirm with your contact that you're safe",
  "Rate the other account on VerifyMzansi",
  "Report suspicious behaviour",
];

export default function MeetingChecklistPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <div className="container-page py-4 space-y-3">
          <PageHeader
            title="Meeting Safety Checklist"
            description="Stay safe when meeting buyers or sellers."
            breadcrumbs={[{ label: "Safety" }, { label: "Meeting Checklist" }]}
          />

          {/* Before Meeting */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Badge className="bg-brand-gold text-amber-950 text-xs">Before</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {BEFORE_MEETING.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.text} className="flex items-start gap-2">
                      <div className="rounded-md bg-muted p-1.5 flex-shrink-0">
                        <Icon className="h-3.5 w-3.5 text-brand-green" />
                      </div>
                      <p className="text-xs">{item.text}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* During & After Meeting */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Badge className="bg-brand-green text-white text-xs">During</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {DURING_MEETING.map((tip) => (
                  <li key={tip} className="flex items-start gap-1.5 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-brand-green flex-shrink-0" />
                    {tip}
                  </li>
                ))}
              </ul>

              <div>
                <h3 className="flex items-center gap-2 mb-1.5">
                  <Badge variant="secondary" className="text-xs">
                    After
                  </Badge>
                </h3>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {AFTER_MEETING.map((tip) => (
                    <li key={tip} className="flex items-start gap-1.5 text-xs">
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Emergency */}
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-xs text-destructive">Emergency</p>
              <p className="text-xs text-muted-foreground">
                Call <strong>10111</strong> (SAPS) or <strong>112</strong> (cellphone) immediately
                if unsafe.
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
