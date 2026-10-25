import type { Metadata } from "next";
import { getDataBackend } from "@/lib/data-backend";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import {
  FoundationPublicDetail,
  foundationPublicMetadata,
} from "@/components/foundation/public-marketplace";
import {
  generatePromotionDetailMetadata,
  PromotionDetailPageContent,
} from "@/app/(marketplace)/_lib/promotion-detail-page-content";
import {
  BusinessDetailPageContent,
  generateBusinessDetailMetadata,
} from "@/app/(marketplace)/mzansi-business/_lib/business-detail-page-content";

interface TourismEventDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: TourismEventDetailPageProps): Promise<Metadata> {
  if (getDataBackend() === "foundation")
    return foundationPublicMetadata((await params).id, "tourism_events");
  const { id } = await params;
  const businessMetadata = await generateBusinessDetailMetadata(id, "tourism");

  if (businessMetadata) {
    return businessMetadata;
  }

  return generatePromotionDetailMetadata(id);
}

export default async function TourismEventDetailPage({ params }: TourismEventDetailPageProps) {
  if (getDataBackend() === "foundation")
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <FoundationPublicDetail id={(await params).id} area="tourism_events" />
        <Footer />
      </div>
    );
  const { id } = await params;
  const businessPage = await BusinessDetailPageContent({
    id,
    section: "tourism",
    notFoundOnMissing: false,
  });

  if (businessPage) {
    return businessPage;
  }

  return await PromotionDetailPageContent({ id });
}
