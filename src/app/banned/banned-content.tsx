"use client";

import Link from "next/link";
import { Mail } from "lucide-react";
import { BrandShieldAlert } from "@/components/shared/brand-shield";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

const APPEALS_EMAIL = "appeals@verifymzansi.com";

const CONSEQUENCES = [
  "All active listings removed",
  "Account profile no longer visible",
  "Cannot create new listings",
  "Active subscriptions cancelled",
] as const;

export function BannedPageContent() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main
        id="main-content"
        className="flex flex-1 items-center justify-center px-4 py-12 sm:py-16"
      >
        <div className="hero-panel w-full max-w-lg p-6 sm:p-8">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-red/10 text-brand-red-700 dark:bg-brand-red/15 dark:text-brand-red-300">
            <BrandShieldAlert className="h-7 w-7" aria-hidden="true" />
          </span>

          <h1 className="mt-5 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Your account has been banned
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            This account was permanently banned after a serious breach of our{" "}
            <Link
              href="/terms"
              className="font-semibold text-foreground underline underline-offset-4 hover:text-brand-green-700 dark:hover:text-brand-green-300"
            >
              Terms of Service
            </Link>
            .
          </p>

          <div className="mt-6 rounded-2xl bg-muted/70 p-4">
            <h2 className="text-sm font-semibold text-foreground">What this means</h2>
            <ul className="mt-2 space-y-1.5">
              {CONSEQUENCES.map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm text-foreground/85">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-red-500"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 border-t border-border/70 pt-6">
            <h2 className="text-sm font-semibold text-foreground">Think this is a mistake?</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Email us your registered address and any evidence.
            </p>
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              <Button asChild variant="trust-verified" className="h-11">
                <a href={`mailto:${APPEALS_EMAIL}`}>
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  Email {APPEALS_EMAIL}
                </a>
              </Button>
              <Button asChild variant="outline" className="h-11">
                <Link href="/">Go to homepage</Link>
              </Button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
