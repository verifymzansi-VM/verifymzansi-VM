import Link from "next/link";
import { ShoppingBag, Store, Briefcase, ArrowRight, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = {
  title: "Create a Post | VerifyMzansi",
  description: "Choose what you'd like to post on VerifyMzansi.",
};

const POST_OPTIONS = [
  {
    title: "Mzansi Market Listing",
    description:
      "Sell items like electronics, furniture, cars, and more with classified ads visible to all buyers.",
    icon: ShoppingBag,
    href: "/post/create-listing",
    badge: "Mzansi Market",
    badgeColor: "bg-brand-green text-white",
  },
  {
    title: "Mall Shop Storefront",
    description:
      "Create a branded storefront with multiple products, posts, and promotions. Your digital shop.",
    icon: Store,
    href: "/post/create-mall-shop",
    badge: "Mall Shops",
    badgeColor: "bg-brand-gold text-amber-950",
  },
  {
    title: "Business Ad Profile",
    description:
      "Advertise your business services with a professional profile, service areas, and contact details.",
    icon: Briefcase,
    href: "/post/create-business-ad",
    badge: "Business Ads",
    badgeColor: "bg-sky-700 text-white",
  },
];

export default function PostCreatePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6 space-y-8">
          <PageHeader
            title="Create a Post"
            description="Choose the type of listing you'd like to create."
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Create Post" }]}
          />

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-brand-green" />
            <span>Your verified seller status is displayed on all your posts.</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {POST_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <Link key={option.href} href={option.href}>
                  <Card className="h-full transition-all hover:shadow-lg hover:border-brand-green/50 cursor-pointer">
                    <CardContent className="p-6 space-y-4">
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
