import Link from "next/link";
import { PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatePanel, StatePanelPage } from "@/components/shared/state-panel";

export default function MarketplaceNotFound() {
  return (
    <StatePanelPage withinLayoutMain>
      <StatePanel
        icon={<PackageX />}
        title="This post isn't available"
        description="It may have sold, expired or been removed."
        actions={
          <>
            <Button asChild variant="trust-verified">
              <Link href="/mzansi-market">Browse Mzansi Market</Link>
            </Button>
          </>
        }
        showNextSteps
      />
    </StatePanelPage>
  );
}
