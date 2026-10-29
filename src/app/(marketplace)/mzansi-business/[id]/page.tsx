import type { Metadata } from "next";
import {
  BusinessDetailPageContent,
  generateBusinessDetailMetadata,
  type BusinessDetailPageProps,
} from "../_lib/business-detail-page-content";

export async function generateMetadata({ params }: BusinessDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  return (await generateBusinessDetailMetadata(id)) ?? { title: "Business Not Found" };
}

export default async function BusinessDetailPage({ params }: BusinessDetailPageProps) {
  const { id } = await params;
  return BusinessDetailPageContent({ id, redirectTourism: true });
}
