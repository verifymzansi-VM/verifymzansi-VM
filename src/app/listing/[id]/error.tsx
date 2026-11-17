"use client";

import { useEffect } from "react";
import { useErrorReference } from "@/hooks/use-error-reference";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { StatePanel, StatePanelPage } from "@/components/shared/state-panel";

export default function ListingError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const reference = useErrorReference(error);
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
              <Button variant="trust-verified" onClick={() => retry()}>
                Try again
              </Button>
            </>
          }
          showNextSteps
          footnote={reference ? <>Error reference: {reference}</> : undefined}
        />
      </StatePanelPage>
      <Footer />
    </div>
  );
}
