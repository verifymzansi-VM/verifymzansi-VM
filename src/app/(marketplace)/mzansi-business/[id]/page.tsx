import { notFound } from "next/navigation";
import Link from "next/link";
import {
  MapPin,
  ShieldCheck,
  Phone,
  MessageSquare,
  Store,
  Globe,
  Clock,
  MessageCircle,
  Mail,
  Facebook,
  Instagram,
  Twitter,
  Wrench,
  CreditCard,
  Truck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { TrustBadge } from "@/components/trust/trust-badge";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { ShareButton } from "@/components/shared/share-button";
import { ReportDialog } from "@/components/shared/report-dialog";
import { BusinessGallery } from "@/components/listings/business-gallery";
import { BusinessPromoVideo } from "@/components/listings/business-promo-video";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import {
  BUSINESS_TYPE_LABELS,
  BUSINESS_CATEGORY_LABELS,
  type BusinessType,
  type BusinessCategory,
} from "@/types/enums";
import type { Metadata } from "next";

interface BusinessDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: BusinessDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("business_name, description")
    .eq("id", id)
    .single();

  if (!business) {
    return { title: "Business Not Found" };
  }

  return {
    title: `${business.business_name} | Mzansi Business`,
    description: business.description?.slice(0, 160),
  };
}

export default async function BusinessDetailPage({ params }: BusinessDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", id)
    .eq("status", "live")
    .single();

  if (!business) notFound();

  // Fetch seller profile
  const { data: seller } = await supabase
    .from("seller_profiles")
    .select("id, display_name, location_province, location_city, seller_verification_status")
    .eq("user_id", business.seller_id)
    .single();

  // Fetch linked promotions
  const { data: promotions } = await supabase
    .from("promotions")
    .select("id, title, promotion_type, photos, price_cents, start_date, end_date, created_at")
    .eq("business_id", id)
    .eq("status", "live")
    .order("created_at", { ascending: false })
    .limit(12);

  const trustLevel = seller
    ? computeTrustLevel(seller.seller_verification_status ?? "unverified")
    : null;

  const socialLinks = business.social_links as Record<string, string> | null;
  const opHours = business.operating_hours as Record<string, string> | null;
  const bType = business.business_type as BusinessType;
  const bCategory = business.category as BusinessCategory;
  const galleryPhotos = (business.gallery_photos as string[] | null) ?? [];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.business_name,
    description: business.description?.slice(0, 300),
    ...(business.cover_photo && { image: business.cover_photo }),
    address: {
      "@type": "PostalAddress",
      addressLocality: business.location_city || undefined,
      addressRegion: business.location_province || undefined,
      addressCountry: "ZA",
    },
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="flex-1">
        <div className="container-page py-4 space-y-5">
          {/* Cover Header Area */}
          <div className="relative rounded-2xl overflow-hidden bg-background shadow-sm border">
            {business.cover_photo ? (
              <div className="aspect-[21/9] md:aspect-[4/1] bg-muted overflow-hidden relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={normalizeMediaUrl(business.cover_photo)}
                  alt={`${business.business_name} Cover`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
              </div>
            ) : (
              <div className="aspect-[21/9] md:aspect-[4/1] bg-gradient-to-r from-brand-blue/80 to-brand-blue flex items-center justify-center">
                <Store className="h-20 w-20 text-white/50" />
              </div>
            )}

            {/* Logo and Title */}
            <div className="px-6 pb-6 pt-4 flex flex-col md:flex-row items-center md:items-end gap-6 md:gap-8 -mt-16 md:-mt-20 relative z-10 w-full text-center md:text-left mx-auto">
              <div className="h-32 w-32 rounded-2xl bg-white p-2 shadow-xl border overflow-hidden flex-shrink-0">
                {business.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={normalizeMediaUrl(business.logo_url)}
                    alt={`${business.business_name} Logo`}
                    className="w-full h-full object-contain rounded-xl"
                  />
                ) : (
                  <div className="w-full h-full rounded-xl bg-muted flex items-center justify-center">
                    <Store className="h-10 w-10 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 pt-12 md:pt-0">
                <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">
                  {business.business_name}
                </h1>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mt-3">
                  <Badge variant="outline" className="text-xs">
                    {BUSINESS_TYPE_LABELS[bType]}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {BUSINESS_CATEGORY_LABELS[bCategory]}
                  </Badge>
                  {business.store_number && business.store_number !== "N/A" && (
                    <span className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-md text-foreground text-sm">
                      <Store className="h-4 w-4 text-brand-blue" />
                      Shop {business.store_number}
                    </span>
                  )}
                  {(business.location_province || business.location_city) && (
                    <span className="flex items-center gap-1 text-muted-foreground text-sm">
                      <MapPin className="h-4 w-4" />
                      {[business.location_city, business.location_province]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  )}
                </div>
              </div>
              <div className="hidden md:flex gap-3 self-end mb-2">
                {business.phone && (
                  <Button asChild className="gap-2 shrink-0 shadow-md">
                    <a href={`tel:${business.phone}`}>
                      <Phone className="h-4 w-4" /> Call
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Promo Video Section */}
              {business.cover_video && (
                <BusinessPromoVideo
                  videoUrl={normalizeMediaUrl(business.cover_video)}
                  thumbnailUrl={
                    business.video_thumbnail
                      ? normalizeMediaUrl(business.video_thumbnail)
                      : undefined
                  }
                  businessName={business.business_name}
                />
              )}

              {/* Gallery Photos Section */}
              {galleryPhotos.length > 0 && (
                <BusinessGallery
                  photos={galleryPhotos.map((url: string) => normalizeMediaUrl(url))}
                  businessName={business.business_name}
                />
              )}

              <Card>
                <CardContent className="p-6 space-y-4">
                  <h2 className="font-display text-xl font-bold">About {business.business_name}</h2>
                  <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {business.description || "No description provided."}
                  </p>
                </CardContent>
              </Card>

              {/* Services Offered */}
              {business.services_offered && business.services_offered.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-muted-foreground" />
                      Services Offered
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {business.services_offered.map((service: string, i: number) => (
                        <Badge key={i} variant="secondary">
                          {service}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Mobile Service Badge */}
              {bType === "mobile_service" && business.service_areas && (
                <Card className="border-brand-blue/30 bg-brand-blue/5">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3">
                      <div className="bg-brand-blue/10 p-3 rounded-full">
                        <MapPin className="h-6 w-6 text-brand-blue" />
                      </div>
                      <div>
                        <h3 className="font-display font-semibold text-lg">We Come to You</h3>
                        <p className="text-muted-foreground text-sm">
                          This is a mobile service provider that travels to your location.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Payment Methods & Delivery */}
              {((business.payment_methods_accepted &&
                business.payment_methods_accepted.length > 0) ||
                (business.delivery_options && business.delivery_options.length > 0)) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {business.payment_methods_accepted &&
                    business.payment_methods_accepted.length > 0 && (
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-muted-foreground" />
                            Payment Methods
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex flex-wrap gap-2">
                            {business.payment_methods_accepted.map((method: string) => (
                              <Badge key={method} variant="outline" className="capitalize">
                                {method.replace(/_/g, " ")}
                              </Badge>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                  {business.delivery_options && business.delivery_options.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Truck className="w-4 h-4 text-muted-foreground" />
                          Delivery Options
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2">
                          {business.delivery_options.map((option: string) => (
                            <Badge key={option} variant="outline" className="capitalize">
                              {option.replace(/_/g, " ")}
                            </Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Linked Promotions */}
              {promotions && promotions.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="font-display text-xl font-bold px-1">Promotions & Offers</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {promotions.map((promo) => (
                      <Link key={promo.id} href={`/promotion/${promo.id}`}>
                        <Card className="hover:shadow-md transition-shadow h-full">
                          <CardContent className="p-4">
                            <p className="font-medium line-clamp-1">{promo.title}</p>
                            <p className="text-xs text-muted-foreground capitalize mt-1">
                              {promo.promotion_type}
                            </p>
                            {promo.price_cents != null && (
                              <p className="text-sm font-semibold mt-2">
                                R{(promo.price_cents / 100).toFixed(2)}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center">
                  <Store className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                  <h4 className="font-medium text-lg mb-1">Promotions & Offers</h4>
                  <p className="text-muted-foreground max-w-sm mx-auto">
                    This business has not posted any promotions or offers yet.
                  </p>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Contact Card */}
              <Card className="shadow-md border-t-4 border-t-brand-blue">
                <CardContent className="p-6 space-y-5">
                  <h3 className="font-display font-bold text-lg">Contact Business</h3>

                  <div className="space-y-3">
                    {business.phone && (
                      <a
                        href={`tel:${business.phone}`}
                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <div className="bg-primary/10 p-2 rounded-full text-primary">
                          <Phone className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                            Call
                          </p>
                          <p className="font-medium">{business.phone}</p>
                        </div>
                      </a>
                    )}

                    {business.whatsapp && (
                      <a
                        href={`https://wa.me/${business.whatsapp.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 rounded-lg bg-green-50 hover:bg-green-100 transition-colors border border-green-100"
                      >
                        <div className="bg-green-500 p-2 rounded-full text-white">
                          <MessageCircle className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-xs text-green-700 font-medium uppercase tracking-wider">
                            WhatsApp
                          </p>
                          <p className="font-medium text-green-900">{business.whatsapp}</p>
                        </div>
                      </a>
                    )}

                    {business.email && (
                      <a
                        href={`mailto:${business.email}`}
                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <div className="bg-secondary p-2 rounded-full text-secondary-foreground">
                          <Mail className="h-5 w-5" />
                        </div>
                        <div className="overflow-hidden">
                          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                            Email
                          </p>
                          <p className="font-medium truncate">{business.email}</p>
                        </div>
                      </a>
                    )}

                    {!business.phone && !business.whatsapp && !business.email && (
                      <a
                        href={`mailto:support@verifymzansi.co.za?subject=Enquiry about ${encodeURIComponent(business.business_name)}&body=Hi, I found ${encodeURIComponent(business.business_name)} on VerifyMzansi and would like to get in touch.`}
                      >
                        <Button className="w-full gap-2" size="lg">
                          <MessageSquare className="h-4 w-4" />
                          Send Message via Platform
                        </Button>
                      </a>
                    )}
                  </div>

                  {socialLinks && Object.keys(socialLinks).length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-3">
                          Connect Online
                        </p>
                        <div className="flex gap-2">
                          {socialLinks.facebook && (
                            <a
                              href={socialLinks.facebook}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Facebook"
                              className="p-2.5 rounded-full bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2]/20 transition-colors"
                            >
                              <Facebook className="h-5 w-5 fill-current" />
                            </a>
                          )}
                          {socialLinks.instagram && (
                            <a
                              href={socialLinks.instagram}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Instagram"
                              className="p-2.5 rounded-full bg-[#E4405F]/10 text-[#E4405F] hover:bg-[#E4405F]/20 transition-colors"
                            >
                              <Instagram className="h-5 w-5" />
                            </a>
                          )}
                          {socialLinks.twitter && (
                            <a
                              href={socialLinks.twitter}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Twitter"
                              className="p-2.5 rounded-full bg-black/5 text-black hover:bg-black/10 transition-colors dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                            >
                              <Twitter className="h-5 w-5 fill-current" />
                            </a>
                          )}
                          {business.website && (
                            <a
                              href={business.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Website"
                              className="p-2.5 rounded-full bg-muted text-foreground hover:bg-muted/80 transition-colors"
                            >
                              <Globe className="h-5 w-5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Operating Hours */}
              {opHours && Object.keys(opHours).length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      Operating Hours
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      {opHours.Mon_Fri && (
                        <div className="flex justify-between items-center py-1">
                          <span className="text-muted-foreground">Mon - Fri</span>
                          <span className="font-medium">{opHours.Mon_Fri}</span>
                        </div>
                      )}
                      {opHours.Sat && (
                        <div className="flex justify-between items-center py-1 border-t">
                          <span className="text-muted-foreground">Saturday</span>
                          <span className="font-medium">{opHours.Sat}</span>
                        </div>
                      )}
                      {opHours.Sun && (
                        <div className="flex justify-between items-center py-1 border-t">
                          <span className="text-muted-foreground">Sunday / Holidays</span>
                          <span className="font-medium">{opHours.Sun}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Owner Info */}
              <Card>
                <CardContent className="p-5 space-y-4">
                  <h3 className="font-display font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                    Managed By
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{seller?.display_name || "Verified Owner"}</p>
                      {trustLevel && <TrustBadge level={trustLevel} size="sm" />}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex items-center justify-between px-1">
                <ShareButton
                  title={business.business_name}
                  text={`Check out ${business.business_name} on VerifyMzansi`}
                />
                <ReportDialog
                  targetId={business.id}
                  targetType="business"
                  targetName={business.business_name}
                />
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
