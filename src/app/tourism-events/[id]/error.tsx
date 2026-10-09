"use client";

import { useEffect } from "react";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatePanel, StatePanelPage } from "@/components/shared/state-panel";

export default function PromotionError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[PromotionError]", error.digest ?? error.message);
  }, [error]);

  return (
    <StatePanelPage withinLayoutMain>
      <StatePanel
        tone="error"
        icon={<CloudOff />}
        title="This post didn't load"
        description="It's usually temporary. Please try again."
        actions={
          <>
            <Button variant="trust-verified" onClick={() => retry()}>
              Try again
            </Button>
          </>
        }
        showNextSteps
        footnote={error.digest ? <>Error reference: {error.digest}</> : undefined}
      />
    </StatePanelPage>
  );
}
