import Link from "next/link";
import { ShoppingBag, Building2, Megaphone, ArrowRight, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata = {
  title: "Create a Post",
  description: "Choose what you'd like to post on VerifyMzansi.",
};

const POST_OPTIONS = [
  {
    title: "Mzansi Market Listing",
    description: "Best for products, vehicles, property, and everyday listings.",
    icon: ShoppingBag,
    href: "/post/create-listing",
    badge: "Mzansi Market",
    badgeColor: "bg-brand-green text-white",
  },
  {
    title: "Mzansi Business",
    description: "Best for a business profile with services, hours, and contacts.",
    icon: Building2,
    href: "/post/create-business",
    badge: "Mzansi Business",
    badgeColor: "bg-brand-blue text-white",
  },
  {
    title: "Promotions & Events",
    description: "Best for offers, launches, campaigns, and upcoming events.",
    icon: Megaphone,
    href: "/post/create-promotion",
    badge: "Promotions & Events",
    badgeColor: "bg-amber-600 text-white",
  },
];

export default function PostCreatePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6 space-y-4">
          <PageHeader
            title="Create a Post"
            description="Choose the right area, complete 3 quick steps, and submit for review."
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Create Post" }]}
          />

          <Alert
            variant="info"
            hideIcon
            className="border-foreground/10 bg-muted/40 text-foreground"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <AlertTitle>How posting works</AlertTitle>
              <AlertDescription>
                Pick your area, complete the guided form, and submit your post for review.
              </AlertDescription>
            </div>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {POST_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <Link key={option.href} href={option.href}>
                  <Card className="h-full cursor-pointer transition-all hover:border-brand-green/50 hover:shadow-lg">
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="rounded-lg bg-muted p-3">
                          <Icon
                            className={`h-6 w-6 ${
                              option.badge === "Mzansi Business"
                                ? "text-brand-blue"
                                : option.badge === "Promotions & Events"
                                  ? "text-amber-600"
                                  : "text-brand-green"
                            }`}
                          />
                        </div>
                        <Badge className={option.badgeColor}>{option.badge}</Badge>
                      </div>
                      <div className="space-y-2">
                        <h2 className="font-display text-lg font-semibold">{option.title}</h2>
                        <p className="text-sm text-muted-foreground">{option.description}</p>
                      </div>
                      <div className="flex items-center gap-1 text-sm font-medium text-brand-green">
                        Get Started
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
