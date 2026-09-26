import Link from "next/link";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { StatePanel, StatePanelPage } from "@/components/shared/state-panel";

type ErrorPageSearchParams = {
  reason?: string;
};

function getMessage(reason?: string) {
  switch (reason) {
    case "unavailable":
      return {
        title: "Service temporarily unavailable",
        description: "We couldn't verify your account details right now. Please try again shortly.",
      };
    default:
      return {
        title: "Something went wrong",
        description: "Please try again in a moment.",
      };
  }
}

export default async function ErrorPage({
  searchParams,
}: {
  searchParams?: Promise<ErrorPageSearchParams>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const message = getMessage(params?.reason);

  return (
    <div className="flex min-h-screen flex-col bg-hero-mesh">
      <Header />
      <StatePanelPage>
        <StatePanel
          tone="error"
          icon={<CloudOff />}
          title={message.title}
          description={message.description}
          actions={
            <>
              <Button asChild variant="trust-verified">
                <Link href="/dashboard">Go to dashboard</Link>
              </Button>
              <Button asChild variant="outline">
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
