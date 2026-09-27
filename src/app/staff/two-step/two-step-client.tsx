"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Step =
  | { kind: "loading" }
  | { kind: "enrol" }
  | { kind: "scan"; factorId: string; qrUrl: string | null; secret: string }
  | { kind: "verify"; factorId: string };

/** Supabase returns the QR code as an SVG data URI; the CSP only allows blob: images. */
function svgDataUriToBlobUrl(dataUri: string): string | null {
  const comma = dataUri.indexOf(",");
  if (!dataUri.startsWith("data:image/svg+xml") || comma < 0) return null;
  const payload = dataUri.slice(comma + 1);
  const svg = dataUri.slice(0, comma).endsWith(";base64")
    ? atob(payload)
    : decodeURIComponent(payload);
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

export function StaffTwoStepClient({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.mfa.listFactors()
      .then(({ data, error: listError }) => {
        if (cancelled) return;
        if (listError) {
          setError("Your authenticator settings could not be loaded. Refresh to try again.");
          setStep({ kind: "enrol" });
          return;
        }
        const verified = data?.totp.find((factor) => factor.status === "verified");
        setStep(verified ? { kind: "verify", factorId: verified.id } : { kind: "enrol" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (step.kind === "scan" && step.qrUrl) URL.revokeObjectURL(step.qrUrl);
    };
  }, [step]);

  async function startEnrolment() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    try {
      // Remove any half-finished setup so enrolment can start cleanly.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const factor of factors?.all ?? []) {
        if (factor.factor_type === "totp" && factor.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }
      const { data, error: enrolError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "VerifyMzansi staff",
      });
      if (enrolError || !data) throw enrolError ?? new Error("No enrolment data");
      setStep({
        kind: "scan",
        factorId: data.id,
        qrUrl: svgDataUriToBlobUrl(data.totp.qr_code),
        secret: data.totp.secret,
      });
    } catch {
      setError("Setup could not start. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (step.kind !== "scan" && step.kind !== "verify") return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
      factorId: step.factorId,
      code,
    });
    if (verifyError) {
      setBusy(false);
      setCode("");
      setError("That code did not work. Enter the current code from your app.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  if (step.kind === "loading") {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />;
  }

  if (step.kind === "enrol") {
    return (
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="text-sm">
          Install an authenticator app such as Google Authenticator, Microsoft Authenticator or
          1Password, then set it up here.
        </p>
        <Button onClick={startEnrolment} disabled={busy} className="w-full gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Set up authenticator app
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      {step.kind === "scan" && (
        <div className="space-y-3 rounded-2xl border bg-card p-4">
          <p className="text-sm">Scan this code with your authenticator app.</p>
          {step.qrUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- local blob URL of a generated QR code
            <img src={step.qrUrl} alt="QR code for your authenticator app" className="mx-auto h-44 w-44 bg-white p-2" />
          )}
          <p className="text-xs text-muted-foreground">
            Can&apos;t scan it? Enter this key instead:{" "}
            <code className="break-all font-mono text-foreground">{step.secret}</code>
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="staff-mfa-code">6-digit code</Label>
        <Input
          id="staff-mfa-code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          autoComplete="one-time-code"
          required
          autoFocus
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || code.length !== 6} className="w-full gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Verify code
      </Button>
    </form>
  );
}
