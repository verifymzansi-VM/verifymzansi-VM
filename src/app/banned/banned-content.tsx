"use client";

import { BrandShieldAlert as ShieldAlert } from "@/components/shared/brand-shield";
import { AlertTriangle, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";

export function BannedPageContent() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center px-4 py-12 overflow-hidden relative">
        <div className="container-page max-w-md text-center space-y-5 relative z-10">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-destructive/20 bg-destructive/10 shadow-xs">
            <ShieldAlert className="h-8 w-8 text-destructive" aria-hidden="true" />
          </div>

          <h1 className="font-display text-2xl font-bold tracking-tight text-destructive">
            Account Banned
          </h1>

          <div>
            <Card className="rounded-2xl border-destructive/20 elev-md overflow-hidden">
              <div className="h-1.5 w-full bg-destructive" />
              <CardContent className="p-4 space-y-3 text-left bg-gradient-to-b from-destructive/5 to-transparent">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-base">
                      Your account has been permanently banned
                    </p>
                    <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                      Due to a severe violation of our{" "}
                      <Link
                        href="/terms"
                        className="text-destructive font-medium underline underline-offset-4 hover:text-destructive/80 transition-colors"
                      >
                        Terms of Service
                      </Link>
                      .
                    </p>
                  </div>
                </div>

                <div className="bg-background/50 rounded-xl p-3 border border-border/50">
                  <p className="text-xs font-medium mb-1">When your account is banned:</p>
                  <ul className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    {[
                      "All active listings removed",
                      "Account profile no longer visible",
                      "Cannot create new listings",
                      "Active subscriptions cancelled",
                    ].map((item, i) => (
                      <li key={i}>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-destructive/50" />
                          {item}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">Believe this was a mistake?</p>
                  <div className="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-full bg-muted/50 border border-border/60">
                    <Mail className="h-3.5 w-3.5 text-foreground/70" />
                    <a
                      href="mailto:appeals@verifymzansi.com"
                      className="text-xs font-medium underline"
                    >
                      appeals@verifymzansi.com
                    </a>
                  </div>
                </div>

                <Button asChild variant="outline" className="w-full rounded-full hover:bg-muted">
                  <Link href="/">Return to Homepage</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
