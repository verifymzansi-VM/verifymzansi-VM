"use client";

import { useEffect } from "react";
import { useErrorReference } from "@/hooks/use-error-reference";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatePanel, StatePanelPage } from "@/components/shared/state-panel";

export default function MzansiMarketError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const reference = useErrorReference(error);
  useEffect(() => {
    console.error("[MzansiMarketError]", error.digest ?? error.message);
  }, [error]);

  return (
    <StatePanelPage withinLayoutMain>
      <StatePanel
        tone="error"
        icon={<CloudOff />}
        title="Mzansi Market didn't load"
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
  );
}
