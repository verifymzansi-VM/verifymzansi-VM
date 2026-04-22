import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import type { Metadata } from "next";
import {
  generatePromotionDetailMetadata,
  PromotionDetailPageContent,
} from "@/app/(marketplace)/_lib/promotion-detail-page-content";

interface PromotionDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PromotionDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  return generatePromotionDetailMetadata(id);
}

export default async function PromotionDetailPage({ params }: PromotionDetailPageProps) {
  const { id } = await params;
  const content = await PromotionDetailPageContent({ id });

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{content}</main>

      <Footer />
    </div>
  );
}
