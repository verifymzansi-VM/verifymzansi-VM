import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { StatePanel, StatePanelPage } from "@/components/shared/state-panel";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-hero-mesh">
      <Header />
      <StatePanelPage>
        <StatePanel
          icon={<SearchX />}
          eyebrow="Error 404"
          title="Page not found"
          description="This link is broken or the page has moved."
          actions={
            <>
              <Button asChild variant="trust-verified">
                <Link href="/">Go to homepage</Link>
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
