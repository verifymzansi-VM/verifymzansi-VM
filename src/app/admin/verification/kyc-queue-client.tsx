"use client";

import { useRouter } from "next/navigation";
import { KycQueueTable } from "@/components/admin/kyc-queue-table";
import type { PendingVerificationGroup } from "@/lib/utils/admin-queries";

export function KycQueueClient({
  initialGroups,
  evidenceDeskEnabled = false,
}: {
  initialGroups: PendingVerificationGroup[];
  evidenceDeskEnabled?: boolean;
}) {
  const router = useRouter();

  return (
    <KycQueueTable
      groups={initialGroups}
      onDecisionComplete={() => router.refresh()}
      evidenceDeskEnabled={evidenceDeskEnabled}
    />
  );
}
