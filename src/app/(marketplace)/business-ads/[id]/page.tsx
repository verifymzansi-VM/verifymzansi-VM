import { notFound } from "next/navigation";
import Link from "next/link";
import {
  MapPin,
  ShieldCheck,
  Phone,
  MessageSquare,
  ArrowLeft,
  Briefcase,
  Globe,
  Clock,
  MessageCircle,
  Mail,
  Facebook,
  Instagram,
  Twitter,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { TrustBadge } from "@/components/trust/trust-badge";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { ShareButton } from "@/components/shared/share-button";
import { ReportDialog } from "@/components/shared/report-dialog";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import type { Metadata } from "next";

// Helper to determine media type robustly, ignoring query parameters
const isVideoMedia = (url: string) => /\.(mp4|webm|mov)(\?.*)?$/i.test(url);

// Helper to format external URLs correctly avoiding relative link issues
const formatExternalUrl = (url: string) => {
  if (!url) return "#";
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || /^tel:/i.test(url)) {
    return url;
  }
  return `https://${url}`;
};

interface BusinessAdDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: BusinessAdDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: ad } = await supabase
    .from("business_profiles")
    .select("business_name, about")
    .eq("id", id)
    .single();

  if (!ad) {
    return { title: "Business Not Found | VerifyMzansi" };
  }

  return {
    title: `${ad.business_name} | Business Ads`,
    description: ad.about?.slice(0, 160),
  };
}

export default async function BusinessAdDetailPage({ params }: BusinessAdDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: ad } = await supabase
    .from("business_profiles")
    .select("*")
    .eq("id", id)
    .eq("status", "live")
    .single();

  if (!ad) notFound();

  // Fetch seller profile via seller_id
  const { data: seller } = await supabase
    .from("seller_profiles")
    .select("id, display_name, location_province, location_city, seller_verification_status")
    .eq("user_id", ad.seller_id)
    .single();

  const trustLevel = seller
    ? computeTrustLevel(seller.seller_verification_status ?? "unverified")
    : null;

  const socialLinks = ad.social_links as Record<string, string> | null;
  const opHours = ad.operating_hours as Record<string, string> | null;

  // Safely extract location data
  let province = "";
  let city = "";
  let specificAreas: string[] = [];

  if (ad.service_areas && typeof ad.service_areas === "object") {
    const areasObj = ad.service_areas as Record<string, unknown>;
    province = typeof areasObj.province === "string" ? areasObj.province : "";
    city = typeof areasObj.city === "string" ? areasObj.city : "";
    if (Array.isArray(areasObj.areas)) {
      specificAreas = areasObj.areas.filter((a) => typeof a === "string") as string[];
    }
  }

  // Fallbacks if not set in service_areas json specifically
  const displayProvince = province || seller?.location_province;
  const displayCity = city || seller?.location_city;

  return (
    <div className="container-page py-6 space-y-6">
      <Link
        href="/business-ads"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Business Ads
      </Link>

      {/* Cover Header Area */}
      <div className="relative rounded-2xl overflow-hidden bg-background shadow-sm border">
        {/* Cover Image/Video */}
        {ad.cover_photo ? (
          <div className="aspect-[21/9] md:aspect-[4/1] bg-muted overflow-hidden relative">
            {isVideoMedia(ad.cover_photo) ? (
              <video
                src={normalizeMediaUrl(ad.cover_photo)}
                autoPlay
                muted
                loop
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={normalizeMediaUrl(ad.cover_photo)}
                alt={`${ad.business_name} Cover`}
                className="w-full h-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
          </div>
        ) : (
          <div className="aspect-[21/9] md:aspect-[4/1] bg-gradient-to-r from-sky-600/80 to-sky-600 flex items-center justify-center">
            <Briefcase className="h-20 w-20 text-white/50" />
          </div>
        )}

        {/* Logo and Title Overlap Overlay */}
        <div className="px-6 pb-6 pt-4 flex flex-col md:flex-row items-center md:items-end gap-6 md:gap-8 -mt-16 md:-mt-20 relative z-10 w-full text-center md:text-left mx-auto">
          <div className="h-32 w-32 rounded-2xl bg-white p-2 shadow-xl border overflow-hidden flex-shrink-0">
            {ad.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={normalizeMediaUrl(ad.logo_url)}
                alt={`${ad.business_name} Logo`}
                className="w-full h-full object-contain rounded-xl"
              />
            ) : (
              <div className="w-full h-full rounded-xl bg-muted flex items-center justify-center">
                <Briefcase className="h-10 w-10 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1 pt-12 md:pt-0">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">
              {ad.business_name}
            </h1>
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mt-3 text-muted-foreground text-sm font-medium">
              {ad.services_offered?.[0] && (
                <span className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-md text-foreground">
                  <Briefcase className="h-4 w-4 text-sky-600" />
                  {ad.services_offered[0]}
                </span>
              )}
              {(displayProvince || displayCity) && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {[displayCity, displayProvince].filter(Boolean).join(", ")}
                </span>
              )}
            </div>
          </div>
          <div className="hidden md:flex gap-3 self-end mb-2">
            {(ad.phone || ad.whatsapp || ad.email) && (
              <Button className="gap-2 shrink-0 shadow-md" asChild>
                <a href="#contact-card">
                  <Phone className="h-4 w-4" /> Contact
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* About Section */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="font-display text-xl font-bold">About {ad.business_name}</h2>
              <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {ad.about || "No description provided."}
              </p>
            </CardContent>
          </Card>

          {/* Services Offered Details */}
          {(ad.services_offered && ad.services_offered.length > 0) || specificAreas.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-xl">Areas of Expertise</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {ad.services_offered && ad.services_offered.length > 0 && (
                  <div>
                    <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wider mb-3">
                      Core Services
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {ad.services_offered.map((service: string, idx: number) => (
                        <Badge
                          key={service || idx}
                          variant="secondary"
                          className="px-3 py-1 text-sm bg-sky-50 text-sky-900 hover:bg-sky-100 border border-sky-100"
                        >
                          {service}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {specificAreas && specificAreas.length > 0 && (
                  <div>
                    <Separator className="my-4" />
                    <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wider mb-3">
                      Specific Service Areas
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {specificAreas
                        .flatMap((area) => area.split(","))
                        .map((area) => area.trim())
                        .filter(Boolean)
                        .map((area, idx) => (
                          <Badge key={area || idx} variant="outline" className="px-3 py-1">
                            <MapPin className="w-3 h-3 mr-1 text-muted-foreground" />
                            {area}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Gallery */}
          {ad.photos && ad.photos.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-display text-xl font-bold px-1">Portfolio Gallery</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {ad.photos.map((photoUrl: string, idx: number) => (
                  <div
                    key={photoUrl || idx}
                    className="aspect-square rounded-xl overflow-hidden bg-muted border shadow-sm"
                  >
                    {isVideoMedia(photoUrl) ? (
                      <video
                        src={normalizeMediaUrl(photoUrl)}
                        controls
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={normalizeMediaUrl(photoUrl)}
                        alt={`Gallery image ${idx + 1}`}
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Contact Card */}
          <Card id="contact-card" className="shadow-md border-t-4 border-t-sky-600 scroll-mt-24">
            <CardContent className="p-6 space-y-5">
              <h3 className="font-display font-bold text-lg">Contact Business</h3>

              <div className="space-y-3">
                {ad.phone && (
                  <a
                    href={`tel:${ad.phone}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="bg-primary/10 p-2 rounded-full text-primary">
                      <Phone className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                        Call
                      </p>
                      <p className="font-medium">{ad.phone}</p>
                    </div>
                  </a>
                )}

                {ad.whatsapp && (
                  <a
                    href={`https://wa.me/${ad.whatsapp.replace(/\D/g, "")}`}
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
                      <p className="font-medium text-green-900">{ad.whatsapp}</p>
                    </div>
                  </a>
                )}

                {ad.email && (
                  <a
                    href={`mailto:${ad.email}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="bg-secondary p-2 rounded-full text-secondary-foreground">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                        Email
                      </p>
                      <p className="font-medium truncate">{ad.email}</p>
                    </div>
                  </a>
                )}

                {!ad.phone && !ad.whatsapp && !ad.email && (
                  <a
                    href={`mailto:support@verifymzansi.co.za?subject=Enquiry about ${encodeURIComponent(ad.business_name)}&body=Hi, I found ${encodeURIComponent(ad.business_name)} on VerifyMzansi and would like to get in touch.`}
                  >
                    <Button className="w-full gap-2" size="lg">
                      <MessageSquare className="h-4 w-4" />
                      Send Enquiry
                    </Button>
                  </a>
                )}
              </div>

              {((socialLinks && Object.keys(socialLinks).length > 0) || ad.website) && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-3">Connect Online</p>
                    <div className="flex gap-2">
                      {socialLinks?.facebook && (
                        <a
                          href={formatExternalUrl(socialLinks.facebook)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Facebook"
                          className="p-2.5 rounded-full bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2]/20 transition-colors"
                        >
                          <Facebook className="h-5 w-5 fill-current" />
                        </a>
                      )}
                      {socialLinks?.instagram && (
                        <a
                          href={formatExternalUrl(socialLinks.instagram)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Instagram"
                          className="p-2.5 rounded-full bg-[#E4405F]/10 text-[#E4405F] hover:bg-[#E4405F]/20 transition-colors"
                        >
                          <Instagram className="h-5 w-5" />
                        </a>
                      )}
                      {socialLinks?.twitter && (
                        <a
                          href={formatExternalUrl(socialLinks.twitter)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Twitter"
                          className="p-2.5 rounded-full bg-black/5 text-black hover:bg-black/10 transition-colors dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                        >
                          <Twitter className="h-5 w-5 fill-current" />
                        </a>
                      )}
                      {ad.website && (
                        <a
                          href={formatExternalUrl(ad.website)}
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

          {/* Operating Hours Card */}
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
                Business Owner
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
              title={ad.business_name}
              text={`Check out ${ad.business_name} on VerifyMzansi`}
            />
            <ReportDialog
              targetId={ad.id}
              targetType="business_profile"
              targetName={ad.business_name}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
