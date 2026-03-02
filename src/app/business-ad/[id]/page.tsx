import { redirect } from "next/navigation";
import type { Metadata } from "next";

interface BusinessAdDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params: _params,
}: BusinessAdDetailPageProps): Promise<Metadata> {
  return {
    title: "Redirecting... | VerifyMzansi",
  };
}

/**
 * Legacy route: /business-ad/[id]
 * Permanently redirects to the canonical /business-ads/[id] route.
 */
export default async function BusinessAdDetailPage({ params }: BusinessAdDetailPageProps) {
  const { id } = await params;
  redirect(`/business-ads/${id}`);
}
