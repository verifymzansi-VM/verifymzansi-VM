"use client";

import { useRouter } from "next/navigation";
import { KycQueueTable } from "@/components/admin/kyc-queue-table";

interface PendingStep {
  id: string;
  user_id: string;
  step_type: string;
  status: string;
  created_at: string;
  account_display_name?: string | null;
  account_verification_status?: string | null;
  seller_display_name?: string | null;
  seller_verification_status: string | null;
}

export function KycQueueClient({
  initialSteps,
  evidenceDeskEnabled = false,
}: {
  initialSteps: PendingStep[];
  evidenceDeskEnabled?: boolean;
}) {
  const router = useRouter();

  return (
    <KycQueueTable
      steps={initialSteps}
      onDecisionComplete={() => router.refresh()}
      evidenceDeskEnabled={evidenceDeskEnabled}
    />
  );
}
