import type { Metadata } from "next";
import {
  generatePromotionDetailMetadata,
  PromotionDetailPageContent,
} from "@/app/(marketplace)/_lib/promotion-detail-page-content";

interface TourismEventDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: TourismEventDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  return generatePromotionDetailMetadata(id);
}

export default async function TourismEventDetailPage({ params }: TourismEventDetailPageProps) {
  const { id } = await params;
  return <PromotionDetailPageContent id={id} />;
}
