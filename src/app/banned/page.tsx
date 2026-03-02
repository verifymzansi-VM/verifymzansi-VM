"use client";

import { ShieldAlert, AlertTriangle, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import Link from "next/link";
import { motion } from "framer-motion";

export default function BannedPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center py-20 overflow-hidden relative">
        {/* Background ambient glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-red-500/10 blur-[100px] rounded-full pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="container-page max-w-lg text-center space-y-6 relative z-10"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
            className="mx-auto w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center shadow-[0_0_30px_-5px_var(--tw-shadow-color)] shadow-destructive/30"
          >
            <ShieldAlert className="h-10 w-10 text-destructive" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="font-display text-3xl font-bold tracking-tight text-destructive"
          >
            Account Suspended
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
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
                      . This action was taken after extensive review by our moderation team.
                    </p>
                  </div>
                </div>

                <div className="bg-background/50 rounded-lg p-4 border border-border/50">
                  <p className="text-sm font-medium mb-3">When your account is banned:</p>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {[
                      "All your active listings have been removed",
                      "Your seller profile is no longer visible",
                      "You cannot create new listings or storefronts",
                      "Any active subscriptions have been automatically cancelled",
                    ].map((item, i) => (
                      <li key={i}>
                        <motion.div
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.5 + i * 0.1 }}
                          className="flex items-center gap-2"
                        >
                          <div className="h-1.5 w-1.5 rounded-full bg-destructive/50" />
                          {item}
                        </motion.div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border-t pt-5">
                  <p className="text-sm text-muted-foreground">
                    If you believe this was a critical mistake or your account was compromised, you
                    can appeal by contacting our support team:
                  </p>
                  <div className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 rounded-md bg-muted/50 border border-border">
                    <Mail className="h-4 w-4 text-foreground/70" />
                    <span className="text-sm font-medium">appeals@verifymzansi.co.za</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
            <Button asChild variant="outline" className="mt-4 hover:bg-muted">
              <Link href="/">Return to Homepage</Link>
            </Button>
          </motion.div>
        </motion.div>
      </main>

      <Footer />
    </div>
  );
}
