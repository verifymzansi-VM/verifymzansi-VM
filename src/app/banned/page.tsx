"use client";

import { ShieldAlert, AlertTriangle, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";

export default function BannedPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center py-12 overflow-hidden relative">
        <div className="container-page max-w-lg text-center space-y-5 relative z-10">
          <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="h-7 w-7 text-destructive" />
          </div>

          <h1 className="font-display text-3xl font-bold tracking-tight text-destructive">
            Account Suspended
          </h1>

          <div>
            <Card className="border-destructive/20 shadow-xl overflow-hidden">
              <div className="h-1.5 w-full bg-destructive" />
              <CardContent className="p-6 space-y-5 text-left bg-gradient-to-b from-destructive/5 to-transparent">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-lg">
                      Your account has been permanently banned
                    </p>
                    <p className="text-sm text-foreground/80 mt-1.5 leading-relaxed">
                      Your VerifyMzansi account has been banned due to a severe violation of our{" "}
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

                <div className="bg-background/50 rounded-lg p-4 border border-border/50">
                  <p className="text-sm font-medium mb-2">When your account is banned:</p>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {[
                      "All active listings removed",
                      "Seller profile no longer visible",
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

                <div className="border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    Believe this was a mistake? Contact support:
                  </p>
                  <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-md bg-muted/50 border border-border">
                    <Mail className="h-4 w-4 text-foreground/70" />
                    <span className="text-sm font-medium">appeals@verifymzansi.co.za</span>
                  </div>
                </div>

                <Button asChild variant="outline" className="w-full hover:bg-muted">
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
