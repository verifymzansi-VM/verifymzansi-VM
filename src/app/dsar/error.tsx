"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PRIVACY_CONTACT_EMAIL } from "@/lib/contact-email";

export default function DsarError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DsarError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="hero-panel w-full max-w-md p-6 text-center sm:p-8">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-red/10 text-brand-red-700 dark:bg-brand-red/15 dark:text-brand-red-300">
            <TriangleAlert className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">
            Failed to load data request form
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            We couldn&apos;t load the POPIA data request form. Please try again. If it keeps
            happening, email{" "}
            <a
              href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
              className="font-semibold text-brand-green-700 underline underline-offset-4 dark:text-brand-green-300"
            >
              {PRIVACY_CONTACT_EMAIL}
            </a>
            .
          </p>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <Button variant="trust-verified" className="h-11" onClick={() => reset()}>
              Try again
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() =>
                window.location.assign(new URL("/", window.location.origin).toString())
              }
            >
              Go to homepage
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
