import { restoredBusinessDetail } from "@/lib/foundation/marketplace-server";
import { readRestoredBusinessAffiliations } from "@/lib/foundation/public-business-affiliations";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import { publicPageMetadata } from "@/lib/sharing/page-metadata";
import type { Metadata } from "next";
import { BusinessAffiliationsSection } from "@/components/organisations/business-affiliations-section";
import { ContactActionTracker } from "@/components/analytics/contact-action-tracker";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { BusinessPromotionRecord } from "@/components/business/business-detail-content";
import { BusinessLayoutRouter } from "@/components/business/layouts/business-layout-router";
import { readAccountVerificationStatus } from "@/lib/account/compat";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { isTourismBusinessRecord } from "@/lib/presentation/business-facts";
import { ImmersiveDetailGate } from "@/components/immersive/immersive-detail-gate";
import { presentBusinessSlide } from "@/lib/feed/presenters";

export interface BusinessDetailPageProps {
  params: Promise<{ id: string }>;
}

type BusinessDetailSection = "business" | "tourism";

function getBreadcrumbs(
  isOwnerPreview: boolean,
  businessName: string,
  section: BusinessDetailSection
) {
  const sectionLabel = section === "tourism" ? "Tourism & Events" : "Mzansi Business";
  const dashboardHref =
    section === "tourism" ? "/dashboard/tourism-events" : "/dashboard/businesses";
  const publicHref = section === "tourism" ? "/tourism-events" : "/mzansi-business";

  return isOwnerPreview
    ? [
        { label: "Dashboard", href: "/dashboard" },
        { label: sectionLabel, href: dashboardHref },
        { label: businessName },
      ]
    : [
        { label: "Home", href: "/" },
        { label: sectionLabel, href: publicHref },
        { label: businessName },
      ];
}

function getPreviewLabel(status: string) {
  if (status === "draft") return "Draft";
  if (status === "rejected") return "Rejected";
  if (status === "pending_moderation") return "Pending moderation";
  return "Preview";
}

function getPreviewDescription(status: string) {
  if (status === "draft") {
    return "Draft — only visible to you. Submit to go live.";
  }

  if (status === "rejected") {
    return "Rejected — only visible to you. Update and resubmit.";
  }

  return "Awaiting moderation — only visible to you until approved.";
}

export async function generateBusinessDetailMetadata(
  id: string,
  section: BusinessDetailSection = "business"
): Promise<Metadata | null> {
  const detail = await restoredBusinessDetail(id);

  if (!detail) {
    return null;
  }

  if (detail.isOwnerPreview)
    return { title: "Private profile preview", robots: { index: false, follow: false } };

  const isTourismBusiness = isTourismBusinessRecord(detail.business);
  if (section === "tourism" && !isTourismBusiness) {
    return null;
  }

  const resolvedSection = section === "tourism" || isTourismBusiness ? "tourism" : "business";
  const sectionTitle = resolvedSection === "tourism" ? "Tourism & Events" : "Mzansi Business";

  return publicPageMetadata({
    previewType: "business",
    title: `${detail.business.business_name} | ${sectionTitle}`,
    description: detail.business.description,
    path: `${resolvedSection === "tourism" ? "/tourism-events" : "/mzansi-business"}/${detail.business.id}`,
    image:
      detail.business.video_thumbnail ||
      detail.business.cover_photo ||
      detail.business.gallery_photos?.[0],
    video: detail.business.cover_video,
  });
}

export async function BusinessDetailPageContent({
  id,
  section = "business",
  redirectTourism = false,
  notFoundOnMissing = true,
}: {
  id: string;
  section?: BusinessDetailSection;
  redirectTourism?: boolean;
  notFoundOnMissing?: boolean;
}) {
  const detail = await restoredBusinessDetail(id);

  if (!detail) {
    if (notFoundOnMissing) {
      notFound();
    }
    return null;
  }

  const { business, ownerProfile, isOwnerPreview } = detail;
  const promotions: BusinessPromotionRecord[] = detail.promotions;
  const isTourismBusiness = isTourismBusinessRecord(business);
  if (section === "tourism" && !isTourismBusiness) {
    if (notFoundOnMissing) {
      notFound();
    }
    return null;
  }

  const resolvedSection = section === "tourism" || isTourismBusiness ? "tourism" : "business";

  if (redirectTourism && !isOwnerPreview && resolvedSection === "tourism") {
    redirect(`/tourism-events/${business.id}`);
  }

  const trustLevel = ownerProfile
    ? computeTrustLevel(readAccountVerificationStatus(ownerProfile))
    : null;
  const breadcrumbs = getBreadcrumbs(isOwnerPreview, business.business_name, resolvedSection);
  const affiliations = isOwnerPreview
    ? []
    : await readRestoredBusinessAffiliations(foundationServerPublicApi(), [business.id]).catch(
        () => []
      );
  const promotionsWithLikes = promotions.map((promotion) => ({
    ...promotion,
    view_count: null,
    like_count: null,
    viewer_has_liked: false,
  }));
  const businessViewCount = business.view_count ?? 0;
  // Owner previews of drafts keep the classic page with its preview banner.
  const immersiveSlide = !isOwnerPreview
    ? presentBusinessSlide(business, ownerProfile, promotions, {
        views: businessViewCount,
        likes: 0,
        viewerHasLiked: false,
        shares: null,
      })
    : null;

  const page = (
    <div>
      <div className="container-page space-y-5 py-5 lg:space-y-6 lg:py-8">
        <Breadcrumbs items={breadcrumbs} />

        {isOwnerPreview && (
          <Alert variant="warning">
            <div className="space-y-2">
              <Badge variant="secondary" className="w-fit">
                Owner preview
              </Badge>
              <AlertTitle>{getPreviewLabel(business.status)}</AlertTitle>
              <AlertDescription>{getPreviewDescription(business.status)}</AlertDescription>
            </div>
          </Alert>
        )}

        {!isOwnerPreview ? (
          <ContactActionTracker table="businesses" id={business.id} website={business.website} />
        ) : null}
        <BusinessLayoutRouter
          business={{
            ...business,
            view_count: businessViewCount,
          }}
          trustLevel={trustLevel}
          ownerProfile={ownerProfile}
          promotions={promotionsWithLikes}
          showPublicActions={!isOwnerPreview}
        />
        <BusinessAffiliationsSection affiliations={affiliations} />
      </div>
    </div>
  );

  return immersiveSlide ? (
    <ImmersiveDetailGate initialSlide={immersiveSlide}>{page}</ImmersiveDetailGate>
  ) : (
    page
  );
}
