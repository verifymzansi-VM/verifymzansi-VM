import Link from "next/link";
import { PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { StatePanel, StatePanelPage } from "@/components/shared/state-panel";

export default function ListingNotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-hero-mesh">
      <Header />
      <StatePanelPage>
        <StatePanel
          icon={<PackageX />}
          title="This listing isn't available"
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
      <Footer />
    </div>
  );
}
