import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  MapPin,
  Calendar,
  Eye,
  ArrowLeft,
  Tag,
  Phone,
  MessageCircle,
  Building2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { TrustBadge } from "@/components/trust/trust-badge";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { formatZAR } from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import {
  PROMOTION_TYPE_LABELS,
  type SellerVerificationStatus,
  type PromotionType,
} from "@/types/enums";
import type { Metadata } from "next";

interface PromotionDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PromotionDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: promotion } = await supabase
    .from("promotions")
    .select("title, description")
    .eq("id", id)
    .single();

  if (!promotion) {
    return { title: "Promotion Not Found | VerifyMzansi" };
  }

  return {
    title: `${promotion.title} | Promotions`,
    description: promotion.description?.slice(0, 160),
  };
}

export default async function PromotionDetailPage({ params }: PromotionDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch promotion
  const { data: promotion } = await supabase
    .from("promotions")
    .select("*")
    .eq("id", id)
    .eq("status", "live")
    .single();

  if (!promotion) notFound();

  // Fetch seller profile
  const { data: seller } = await supabase
    .from("seller_profiles")
    .select("display_name, seller_verification_status, location_province, location_city, strikes")
    .eq("user_id", promotion.seller_id)
    .single();

  const trustLevel = seller
    ? computeTrustLevel(seller.seller_verification_status as SellerVerificationStatus)
    : 0;

  // Fetch linked business (if any)
  const linkedBusiness = promotion.business_id
    ? (
        await supabase
          .from("businesses")
          .select("id, business_name, logo_url")
          .eq("id", promotion.business_id)
          .single()
      ).data
    : null;

  const photos = (promotion.photos || []) as string[];
  const now = new Date();
  const isBoosted = promotion.boost_until ? new Date(promotion.boost_until) > now : false;
  const isFeatured = promotion.featured_until ? new Date(promotion.featured_until) > now : false;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <div className="container-page py-6 space-y-6 max-w-5xl">
          <PageHeader
            title={promotion.title}
            breadcrumbs={[
              { label: "Home", href: "/" },
              { label: "Promotions", href: "/promotions" },
              { label: promotion.title },
            ]}
          >
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link href="/promotions">
                <ArrowLeft className="h-4 w-4" />
                Back to Promotions
              </Link>
            </Button>
          </PageHeader>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Photos + Description */}
            <div className="lg:col-span-2 space-y-6">
              {/* Photo gallery */}
              {photos.length > 0 && (
                <div className="grid grid-cols-1 gap-2">
                  <div className="relative aspect-[16/9] rounded-lg overflow-hidden bg-warm-100 dark:bg-warm-800">
                    <Image
                      src={normalizeMediaUrl(photos[0])}
                      alt={promotion.title}
                      fill
                      className="object-cover"
                      sizes="(max-width: 1024px) 100vw, 66vw"
                      priority
                    />
                    <div className="absolute top-3 left-3 flex gap-1">
                      {isFeatured && (
                        <Badge className="bg-brand-gold text-amber-950">Featured</Badge>
                      )}
                      {isBoosted && <Badge className="bg-brand-blue text-white">Boosted</Badge>}
                      <Badge variant="secondary">
                        {PROMOTION_TYPE_LABELS[promotion.promotion_type as PromotionType] || "Ad"}
                      </Badge>
                    </div>
                  </div>
                  {photos.length > 1 && (
                    <div className="grid grid-cols-4 gap-2">
                      {photos.slice(1, 5).map((photo: string, i: number) => (
                        <div
                          key={i}
                          className="relative aspect-square rounded-lg overflow-hidden bg-warm-100 dark:bg-warm-800"
                        >
                          <Image
                            src={normalizeMediaUrl(photo)}
                            alt={`${promotion.title} photo ${i + 2}`}
                            fill
                            className="object-cover"
                            sizes="(max-width: 640px) 25vw, 16vw"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Description */}
              <Card>
                <CardContent className="p-6 space-y-4">
                  <h2 className="text-lg font-semibold">About this promotion</h2>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {promotion.description}
                  </p>
                </CardContent>
              </Card>

              {/* Details */}
              <Card>
                <CardContent className="p-6 space-y-3">
                  <h2 className="text-lg font-semibold">Details</h2>
                  <div className="grid grid-cols-2 gap-y-2 text-sm">
                    <span className="text-muted-foreground">Type</span>
                    <span className="font-medium">
                      {PROMOTION_TYPE_LABELS[promotion.promotion_type as PromotionType] ||
                        promotion.promotion_type}
                    </span>

                    {promotion.category && (
                      <>
                        <span className="text-muted-foreground">Category</span>
                        <span className="font-medium">{promotion.category}</span>
                      </>
                    )}

                    <span className="text-muted-foreground">Location</span>
                    <span className="font-medium flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {promotion.location_city}, {promotion.location_province}
                    </span>

                    {promotion.start_date && (
                      <>
                        <span className="text-muted-foreground">Starts</span>
                        <span className="font-medium flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(promotion.start_date).toLocaleDateString("en-ZA")}
                        </span>
                      </>
                    )}

                    {promotion.end_date && (
                      <>
                        <span className="text-muted-foreground">Ends</span>
                        <span className="font-medium flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(promotion.end_date).toLocaleDateString("en-ZA")}
                        </span>
                      </>
                    )}

                    <span className="text-muted-foreground">Views</span>
                    <span className="font-medium flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {promotion.view_count || 0}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right: Price + Seller + Contact */}
            <div className="space-y-4">
              {/* Price card */}
              {promotion.price_cents != null && promotion.price_cents > 0 && (
                <Card>
                  <CardContent className="p-6 space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-2xl font-bold">
                        {formatZAR(promotion.price_cents)}
                      </span>
                      {promotion.price_negotiable && (
                        <Badge variant="outline" className="text-brand-green">
                          Negotiable
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Seller info */}
              <Card>
                <CardContent className="p-6 space-y-4">
                  <h3 className="font-semibold">Advertiser</h3>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-brand-green text-white font-bold flex items-center justify-center">
                      {seller?.display_name?.charAt(0)?.toUpperCase() || "S"}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{seller?.display_name || "Seller"}</p>
                      <TrustBadge level={trustLevel} size="sm" />
                    </div>
                  </div>

                  <Separator />

                  {/* Contact buttons */}
                  <div className="space-y-2">
                    {(promotion.contact_methods as string[])?.includes("call") && (
                      <Button variant="outline" className="w-full gap-2">
                        <Phone className="h-4 w-4" />
                        Call Seller
                      </Button>
                    )}
                    {(promotion.contact_methods as string[])?.includes("whatsapp") && (
                      <Button variant="outline" className="w-full gap-2">
                        <MessageCircle className="h-4 w-4" />
                        WhatsApp
                      </Button>
                    )}
                    {(promotion.contact_methods as string[])?.includes("form") && (
                      <Button className="w-full gap-2">
                        <Tag className="h-4 w-4" />
                        Send Enquiry
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Linked Business */}
              {linkedBusiness && (
                <Card>
                  <CardContent className="p-5 space-y-3">
                    <h3 className="font-semibold text-sm text-muted-foreground">From Business</h3>
                    <Link
                      href={`/mzansi-business/${linkedBusiness.id}`}
                      className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                      <div className="h-10 w-10 rounded-lg bg-brand-blue/10 flex items-center justify-center shrink-0 overflow-hidden">
                        {linkedBusiness.logo_url ? (
                          <Image
                            src={normalizeMediaUrl(linkedBusiness.logo_url)}
                            alt={linkedBusiness.business_name}
                            width={40}
                            height={40}
                            className="object-cover"
                          />
                        ) : (
                          <Building2 className="h-5 w-5 text-brand-blue" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {linkedBusiness.business_name}
                        </p>
                        <p className="text-xs text-brand-blue">View Business</p>
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              )}

              {/* Posted date */}
              <p className="text-xs text-muted-foreground text-center">
                Posted {new Date(promotion.created_at).toLocaleDateString("en-ZA")}
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
