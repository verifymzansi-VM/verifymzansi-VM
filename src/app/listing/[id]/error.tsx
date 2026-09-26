"use client";

import { useEffect } from "react";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { StatePanel, StatePanelPage } from "@/components/shared/state-panel";

export default function ListingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ListingError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col bg-hero-mesh">
      <Header />
      <StatePanelPage>
        <StatePanel
          tone="error"
          icon={<CloudOff />}
          title="This listing didn't load"
          description="It's usually temporary. Please try again."
          actions={
            <>
              <Button variant="trust-verified" onClick={() => reset()}>
                Try again
              </Button>
            </>
          }
          showNextSteps
          footnote={error.digest ? <>Error reference: {error.digest}</> : undefined}
        />
      </StatePanelPage>
      <Footer />
    </div>
  );
}
