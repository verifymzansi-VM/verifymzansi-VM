import { CloudOff } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { StatePanel, StatePanelPage } from "@/components/shared/state-panel";
import { ErrorPageActions } from "./error-page-actions";

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
          actions={<ErrorPageActions />}
          showNextSteps
        />
      </StatePanelPage>
      <Footer />
    </div>
  );
}
