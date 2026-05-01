import type { Metadata } from "next";
import {
  generatePromotionDetailMetadata,
  PromotionDetailPageContent,
} from "@/app/(marketplace)/_lib/promotion-detail-page-content";
import {
  BusinessDetailPageContent,
  generateBusinessDetailMetadata,
} from "@/app/(marketplace)/mzansi-business/[id]/page";

interface TourismEventDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: TourismEventDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const businessMetadata = await generateBusinessDetailMetadata(id, "tourism");

  if (businessMetadata) {
    return businessMetadata;
  }

  return generatePromotionDetailMetadata(id);
}

export default async function TourismEventDetailPage({ params }: TourismEventDetailPageProps) {
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
