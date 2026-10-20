"use client";

import { useState } from "react";
import { CircleCheck, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import {
  BrowserInstallSteps,
  InAppInstallSteps,
  IOSInstallSteps,
} from "@/components/pwa/install-steps";
import { isAndroid } from "@/lib/pwa/install-environment";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border/60 bg-card p-6 elev-sm sm:p-8">
      <h2 className="mb-5 font-display text-xl font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function InstallPanel() {
  const { environment, canPrompt, promptInstall } = usePwaInstall();
  const [declined, setDeclined] = useState(false);

  let current: React.ReactNode;
  if (environment === null) {
    current = <div className="h-40 animate-pulse rounded-3xl bg-muted/50" aria-hidden="true" />;
  } else if (environment === "installed") {
    current = (
      <Card title="You're using the app">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck className="h-5 w-5 text-brand-green" aria-hidden="true" />
          VerifyMzansi is on your home screen.
        </p>
      </Card>
    );
  } else if (environment === "in-app") {
    current = (
      <Card title="Open in your browser">
        <InAppInstallSteps pageUrl={new URL("/install", window.location.origin).toString()} />
      </Card>
    );
  } else if (environment === "ios") {
    current = (
      <Card title="Install on iPhone">
        <IOSInstallSteps />
      </Card>
    );
  } else if (canPrompt && !declined) {
    current = (
      <Card title="Install VerifyMzansi">
        <Button
          size="lg"
          className="rounded-full"
          onClick={async () => {
            if ((await promptInstall()) === "dismissed") setDeclined(true);
          }}
        >
          <Download className="mr-2 h-5 w-5" aria-hidden="true" />
          Install
        </Button>
      </Card>
    );
  } else {
    current = (
      <Card title="Install VerifyMzansi">
        <BrowserInstallSteps android={isAndroid(navigator)} />
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {current}
      <details className="rounded-2xl border border-border/60 px-5 py-4 text-sm">
        <summary className="cursor-pointer font-semibold">Another phone</summary>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div className="space-y-3">
            <h3 className="font-semibold">Android</h3>
            <p className="text-muted-foreground">Chrome</p>
            <BrowserInstallSteps android />
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold">iPhone</h3>
            <p className="text-muted-foreground">Safari</p>
            <IOSInstallSteps />
          </div>
        </div>
      </details>
    </div>
  );
}
