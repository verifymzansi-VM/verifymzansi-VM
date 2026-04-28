"use client";

import {
  Facebook,
  Globe,
  Instagram,
  Mail,
  MessageCircle,
  MessageSquare,
  Music2,
  Phone,
  Twitter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { safeExternalHref } from "@/lib/utils/sanitize-html";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";

interface BusinessContactSectionProps {
  business: BusinessDetailRecord;
  /** Renders as a Card with border. Set false for inline/flat rendering. */
  asCard?: boolean;
  /** Compact = no social links section. */
  compact?: boolean;
}

export function BusinessContactSection({
  business,
  asCard = true,
  compact = false,
}: BusinessContactSectionProps) {
  const socialLinks = business.social_links;
  const hasOnlineLinks = Boolean(
    socialLinks?.facebook ||
    socialLinks?.instagram ||
    socialLinks?.twitter ||
    socialLinks?.tiktok ||
    business.website
  );

  const inner = (
    <div className="space-y-5">
      <div>
        <h3 className="font-display text-lg font-bold">Contact Representative</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Contact details were submitted by the person managing this profile. VerifyMzansi reviews
          the poster, not the business itself.
        </p>
      </div>

      <address className="space-y-3 not-italic">
        {business.phone && (
          <a
            href={`tel:${business.phone}`}
            className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 transition-colors hover:bg-muted"
          >
            <div className="rounded-full bg-primary/10 p-2 text-primary">
              <Phone className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
            rel="noopener noreferrer nofollow ugc"
            className="flex items-center gap-3 rounded-lg border border-green-100 bg-green-50 p-3 transition-colors hover:bg-green-100 dark:border-green-800 dark:bg-green-950/40 dark:hover:bg-green-950/60"
          >
            <div className="rounded-full bg-green-500 p-2 text-white">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-green-700 dark:text-green-300">
                WhatsApp
              </p>
              <p className="font-medium text-green-900 dark:text-green-100">{business.whatsapp}</p>
            </div>
          </a>
        )}

        {business.email && (
          <a
            href={`mailto:${business.email}`}
            className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 transition-colors hover:bg-muted"
          >
            <div className="rounded-full bg-secondary p-2 text-secondary-foreground">
              <Mail className="h-5 w-5" />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Email
              </p>
              <p className="truncate font-medium">{business.email}</p>
            </div>
          </a>
        )}

        {!business.phone && !business.whatsapp && !business.email && (
          <a
            href={`mailto:support@verifymzansi.com?subject=Enquiry about ${encodeURIComponent(
              business.business_name
            )}&body=Hi, I found ${encodeURIComponent(
              business.business_name
            )} on VerifyMzansi and would like to get in touch.`}
          >
            <Button className="w-full gap-2" size="lg">
              <MessageSquare className="h-4 w-4" />
              Send Message via Platform
            </Button>
          </a>
        )}
      </address>

      {!compact && hasOnlineLinks && (
        <>
          <Separator />
          <div>
            <p className="mb-3 text-sm font-medium text-muted-foreground">Connect Online</p>
            <div className="flex gap-2">
              {socialLinks?.facebook && (
                <a
                  href={safeExternalHref(socialLinks.facebook)}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  title="Facebook"
                  className="rounded-full bg-[#1877F2]/10 p-2.5 text-[#1877F2] transition-colors hover:bg-[#1877F2]/20"
                >
                  <Facebook className="h-5 w-5 fill-current" />
                </a>
              )}
              {socialLinks?.instagram && (
                <a
                  href={safeExternalHref(socialLinks.instagram)}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  title="Instagram"
                  className="rounded-full bg-[#E4405F]/10 p-2.5 text-[#E4405F] transition-colors hover:bg-[#E4405F]/20"
                >
                  <Instagram className="h-5 w-5" />
                </a>
              )}
              {socialLinks?.twitter && (
                <a
                  href={safeExternalHref(socialLinks.twitter)}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  title="Twitter"
                  className="rounded-full bg-black/5 p-2.5 text-black transition-colors hover:bg-black/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                >
                  <Twitter className="h-5 w-5 fill-current" />
                </a>
              )}
              {socialLinks?.tiktok && (
                <a
                  href={safeExternalHref(socialLinks.tiktok)}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  title="TikTok"
                  className="rounded-full bg-black/5 p-2.5 text-foreground transition-colors hover:bg-black/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                >
                  <Music2 className="h-5 w-5" />
                </a>
              )}
              {business.website && (
                <a
                  href={safeExternalHref(business.website)}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  title="Website"
                  className="rounded-full bg-muted p-2.5 text-foreground transition-colors hover:bg-muted/80"
                >
                  <Globe className="h-5 w-5" />
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );

  if (!asCard) return inner;

  return (
    <Card className="border-t-4 border-t-brand-blue shadow-md">
      <CardContent className="p-6">{inner}</CardContent>
    </Card>
  );
}
