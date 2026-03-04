import Link from "next/link";
import { ShoppingBag, Building2, Megaphone, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = {
  title: "Create a Post",
  description: "Choose what you'd like to post on VerifyMzansi.",
};

const POST_OPTIONS = [
  {
    title: "Mzansi Market Listing",
    description: "Sell items like electronics, furniture, cars, and more on Mzansi Market.",
    icon: ShoppingBag,
    href: "/post/create-listing",
    badge: "Mzansi Market",
    badgeColor: "bg-brand-green text-white",
  },
  {
    title: "Mzansi Business",
    description:
      "Create a professional business profile with services, hours, and contact details.",
    icon: Building2,
    href: "/post/create-business",
    badge: "Mzansi Business",
    badgeColor: "bg-brand-blue text-white",
  },
  {
    title: "Promotion or Event",
    description: "Advertise products, services, deals, or events. Link to your business profile.",
    icon: Megaphone,
    href: "/post/create-promotion",
    badge: "Promotions & Events",
    badgeColor: "bg-purple-700 text-white",
  },
];

export default function PostCreatePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6 space-y-6">
          <PageHeader
            title="Create a Post"
            description="Choose your listing type. Your verified seller status is shown on all posts."
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Create Post" }]}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {POST_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <Link key={option.href} href={option.href}>
                  <Card className="h-full transition-all hover:shadow-lg hover:border-brand-green/50 cursor-pointer">
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="rounded-lg bg-muted p-3">
                          <Icon className="h-6 w-6 text-brand-green" />
                        </div>
                        <Badge className={option.badgeColor}>{option.badge}</Badge>
                      </div>
                      <div className="space-y-2">
                        <h3 className="font-display text-lg font-semibold">{option.title}</h3>
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
