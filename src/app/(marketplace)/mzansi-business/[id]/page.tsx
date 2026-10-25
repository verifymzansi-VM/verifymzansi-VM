import type { Metadata } from "next";
import { getDataBackend } from "@/lib/data-backend";
import {
  FoundationPublicDetail,
  foundationPublicMetadata,
} from "@/components/foundation/public-marketplace";
import {
  BusinessDetailPageContent,
  generateBusinessDetailMetadata,
  type BusinessDetailPageProps,
} from "../_lib/business-detail-page-content";

export async function generateMetadata({ params }: BusinessDetailPageProps): Promise<Metadata> {
  if (getDataBackend() === "foundation")
    return foundationPublicMetadata((await params).id, "business");
  const { id } = await params;
  return (await generateBusinessDetailMetadata(id)) ?? { title: "Business Not Found" };
}

export default async function BusinessDetailPage({ params }: BusinessDetailPageProps) {
  if (getDataBackend() === "foundation")
    return <FoundationPublicDetail id={(await params).id} area="business" />;
  const { id } = await params;
  return BusinessDetailPageContent({ id, redirectTourism: true });
}
