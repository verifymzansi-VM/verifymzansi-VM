"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Clock, KeyRound, Loader2, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { BrandShield } from "@/components/shared/brand-shield";
import { useToast } from "@/hooks/use-toast";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { formatSaLongDate } from "@/lib/utils/format";

type VerifyResult = "valid" | "expired" | "revoked" | "not_found" | null;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HOW_IT_WORKS = [
  { title: "The buyer sends you their token", body: "From their VerifyMzansi account." },
  { title: "You paste it here", body: "See if it is valid, expired or revoked." },
  { title: "Continue carefully", body: "A valid token is not a payment guarantee." },
] as const;

function ResultPanel({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "success" | "warning" | "danger";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    success: {
      box: "border-brand-green/30 bg-brand-green-50 dark:border-brand-green/40 dark:bg-brand-green-950/40",
      icon: "bg-brand-green-600 text-white dark:bg-brand-green-500 dark:text-brand-green-950",
      title: "text-brand-green-800 dark:text-brand-green-200",
    },
    warning: {
      box: "border-brand-gold/40 bg-brand-gold-50 dark:border-brand-gold/30 dark:bg-brand-gold-950/40",
      icon: "bg-brand-gold text-brand-gold-950",
      title: "text-brand-gold-900 dark:text-brand-gold-200",
    },
    danger: {
      box: "border-brand-red/30 bg-brand-red-50 dark:border-brand-red/40 dark:bg-brand-red-950/40",
      icon: "bg-brand-red-600 text-white",
      title: "text-brand-red-800 dark:text-brand-red-200",
    },
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${styles.box}`}>
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${styles.icon}`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className={`font-display text-lg font-bold leading-6 ${styles.title}`}>{title}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function VerifyBuyerPage() {
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult>(null);
  const [buyerInfo, setBuyerInfo] = useState<{
    displayName: string;
    verifiedAt: string;
  } | null>(null);
  const { toast } = useToast();

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmedToken = token.trim();

    if (!trimmedToken) {
      toast({
        title: "Enter a buyer token",
        description: "Paste the token the buyer sent you, then check it.",
        variant: "destructive",
      });
      return;
    }

    if (!UUID_PATTERN.test(trimmedToken)) {
      toast({
        title: "Enter a valid token",
        description:
          "Buyer tokens must be valid UUID values, like 550e8400-e29b-41d4-a716-446655440000.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setResult(null);
    setBuyerInfo(null);

    try {
      if (!(await ensureCsrfTokenReady())) {
        throw new Error("Security check failed");
      }
      const res = await fetch("/api/verify-buyer", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ token: trimmedToken }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 429 && typeof payload.error === "string") {
          toast({
            title: "Too many checks",
            description: payload.error,
            variant: "destructive",
          });
          return;
        }
        throw new Error(payload.error || "Failed to verify token");
      }

      const nextResult = payload.result as VerifyResult;
      setResult(nextResult);

      if (nextResult === "valid" && payload.buyerInfo) {
        setBuyerInfo({
          displayName: payload.buyerInfo.displayName ?? "Buyer",
          verifiedAt: payload.buyerInfo.verifiedAt,
        });
      }
    } catch {
      toast({
        title: "Verification unavailable",
        description: "We couldn't reach the checker. Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const issuedDate = buyerInfo?.verifiedAt ? formatSaLongDate(buyerInfo.verifiedAt) : "";

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <div className="container-page space-y-8 py-6 sm:py-10">
          <PageHeader
            title="Verify a buyer"
            description="Check a buyer token directly before continuing a deal."
            breadcrumbs={[{ label: "Safety", href: "/safety" }, { label: "Verify a buyer" }]}
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-10">
            <section aria-labelledby="token-check-title" className="hero-panel p-5 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="icon-tile area-market-tile">
                  <BrandShield className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2
                  id="token-check-title"
                  className="font-display text-xl font-bold tracking-tight text-foreground"
                >
                  Buyer token check
                </h2>
              </div>

              <form onSubmit={handleVerify} className="mt-6 space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="token">Buyer Token</Label>
                  <div className="relative">
                    <KeyRound
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      id="token"
                      name="token"
                      placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                      value={token}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-describedby="token-hint"
                      className="h-12 pl-10 font-mono text-sm"
                      onChange={(e) => {
                        setToken(e.target.value);
                        setResult(null);
                      }}
                    />
                  </div>
                  <p id="token-hint" className="text-xs leading-5 text-muted-foreground">
                    Tokens are UUIDs and may expire or be revoked.
                  </p>
                </div>

                <Button
                  type="submit"
                  variant="trust-verified"
                  size="lg"
                  className="w-full sm:w-auto"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Search className="h-4 w-4" aria-hidden="true" />
                  )}
                  Verify buyer token
                </Button>
              </form>

              <div className="mt-6" aria-live="polite" aria-busy={isLoading}>
                {isLoading && (
                  <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/50 p-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Checking the token…
                  </div>
                )}

                {!isLoading && result === null && (
                  <div className="rounded-2xl border border-dashed border-border p-4 text-sm leading-6 text-muted-foreground">
                    Your result shows here.
                  </div>
                )}

                {result === "valid" && buyerInfo && (
                  <ResultPanel tone="success" icon={CheckCircle2} title="Buyer's ID reviewed">
                    <p className="text-base font-semibold text-foreground">
                      {buyerInfo.displayName}
                    </p>
                    {issuedDate && (
                      <p className="text-sm text-foreground/80">Token issued {issuedDate}</p>
                    )}
                    <p className="pt-1 text-xs leading-5 text-muted-foreground">
                      This confirms the token check, not that a payment, transfer, courier, or deal
                      is safe.
                    </p>
                  </ResultPanel>
                )}

                {result === "expired" && (
                  <ResultPanel tone="warning" icon={Clock} title="Token expired">
                    <p className="text-sm leading-6 text-foreground/85">
                      Ask the buyer to generate a fresh token and verify it here before continuing.
                    </p>
                  </ResultPanel>
                )}

                {result === "revoked" && (
                  <ResultPanel tone="danger" icon={XCircle} title="Token revoked">
                    <p className="text-sm leading-6 text-foreground/85">
                      This token has been revoked. Do not rely on a screenshot of it.
                    </p>
                  </ResultPanel>
                )}

                {result === "not_found" && (
                  <ResultPanel tone="danger" icon={XCircle} title="Token not found">
                    <p className="text-sm leading-6 text-foreground/85">
                      Invalid token. Ask the buyer to share their current token.
                    </p>
                  </ResultPanel>
                )}
              </div>
            </section>

            <aside aria-labelledby="how-title" className="space-y-4">
              <div className="surface-card p-5 sm:p-6">
                <h2 id="how-title" className="font-body text-base font-semibold text-foreground">
                  How buyer tokens work
                </h2>
                <ol className="mt-4 space-y-4">
                  {HOW_IT_WORKS.map((step, index) => (
                    <li key={step.title} className="flex gap-3.5">
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-xs font-bold text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-300"
                      >
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{step.title}</p>
                        <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
                          {step.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <p className="px-1 text-sm leading-6 text-muted-foreground">
                Meeting up?{" "}
                <Link
                  href="/safety/meeting-checklist"
                  className="font-semibold text-brand-green-700 underline underline-offset-4 dark:text-brand-green-300"
                >
                  Use the meeting checklist
                </Link>
                .
              </p>
            </aside>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
