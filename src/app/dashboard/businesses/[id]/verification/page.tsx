import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { OwnerVerificationPanel } from "@/components/business-verification/owner-verification-panel";

export const metadata = {
  title: "Verify your business",
  description: "Get the CIPC Registered and Seen by VerifyMzansi stickers for your business.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BusinessVerificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verify your business"
        description="Stickers show buyers what VerifyMzansi has checked."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My posts", href: "/dashboard/listings?area=MZANSI_BUSINESS" },
          { label: "Verify" },
        ]}
      />
      <OwnerVerificationPanel businessId={id} />
    </div>
  );
}
