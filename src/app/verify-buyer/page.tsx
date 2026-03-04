"use client";

import { useState } from "react";
import { ShieldCheck, Search, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";

type VerifyResult = "valid" | "expired" | "revoked" | "not_found" | null;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        variant: "destructive",
      });
      return;
    }

    if (!UUID_PATTERN.test(trimmedToken)) {
      toast({
        title: "Enter a valid token",
        description: "Buyer tokens must be valid UUID values.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setResult(null);
    setBuyerInfo(null);

    try {
      const res = await fetch("/api/verify-buyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmedToken }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
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
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <div className="container-page py-6 space-y-6">
          <PageHeader
            title="Verify a Buyer"
            description="Enter a buyer's verification token to check if they're verified on VerifyMzansi. No login required."
            breadcrumbs={[{ label: "Verify a Buyer" }]}
          />

          <div className="mx-auto max-w-md">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="h-5 w-5 text-brand-green" />
                  Buyer Token Check
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleVerify} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="token">Buyer Token</Label>
                    <Input
                      id="token"
                      placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                      value={token}
                      onChange={(e) => {
                        setToken(e.target.value);
                        setResult(null);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Buyers share this token when contacting you. It&apos;s shown on their
                      VerifyMzansi profile.
                    </p>
                  </div>

                  <Button type="submit" className="w-full gap-2" disabled={isLoading}>
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Verify Token
                  </Button>
                </form>

                {/* Result */}
                {result === "valid" && buyerInfo && (
                  <div className="mt-6 rounded-lg border border-brand-green/30 bg-brand-green-50 dark:bg-brand-green-950/30 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-brand-green" />
                      <p className="font-semibold text-brand-green-800 dark:text-brand-green-200">
                        Verified Buyer
                      </p>
                    </div>
                    <p className="text-sm">
                      <strong>{buyerInfo.displayName}</strong>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Verified since{" "}
                      {new Date(buyerInfo.verifiedAt).toLocaleDateString("en-ZA", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                )}

                {result === "expired" && (
                  <div className="mt-6 rounded-lg border border-amber-400/40 bg-amber-50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-700" />
                      <p className="font-semibold text-amber-900">Token Expired</p>
                    </div>
                    <p className="text-sm text-amber-900/90">
                      This token has expired. Ask the buyer to generate a fresh token from their
                      profile.
                    </p>
                  </div>
                )}

                {result === "revoked" && (
                  <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-5 w-5 text-destructive" />
                      <p className="font-semibold text-destructive">Token Revoked</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      This token has been revoked and can no longer be used for verification.
                    </p>
                  </div>
                )}

                {result === "not_found" && (
                  <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-5 w-5 text-destructive" />
                      <p className="font-semibold text-destructive">Token Not Found</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      This token is not valid. Ask the buyer to share their current verification
                      token from their VerifyMzansi profile.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
