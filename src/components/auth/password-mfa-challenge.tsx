"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Verify an already enrolled factor without leaving a password/recovery form. */
export function PasswordMfaChallenge({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    if (!/^\d{6}$/.test(code) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const client = createClient();
      const { data, error: factorError } = await client.auth.mfa.listFactors();
      if (factorError) throw factorError;
      const factor = data?.totp.find((item) => item.status === "verified");
      if (!factor) {
        setError("No verified authenticator is available. Contact support for account recovery.");
        return;
      }
      const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code,
      });
      if (verifyError) {
        setError("That code did not work. Enter the current code from your authenticator app.");
        setCode("");
        return;
      }
      setCode("");
      onVerified();
    } catch {
      setError("Your authenticator could not be verified. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm">Verify your authenticator, then submit your password again.</p>
      <Label htmlFor="password-authenticator-code">Authenticator code</Label>
      <Input
        id="password-authenticator-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void verify();
          }
        }}
        disabled={busy}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" onClick={() => void verify()} disabled={busy || code.length !== 6}>
        {busy ? "Verifying…" : "Verify authenticator"}
      </Button>
    </div>
  );
}
