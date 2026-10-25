"use client";
import { useEffect, useState } from "react";
import { FoundationAccountBoundary } from "@/components/auth/foundation-account-boundary";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { getFoundationBrowserClient } from "@/lib/foundation/browser-client";
import {
  readFoundationReferenceCatalogue,
  type FoundationReferenceCatalogue,
} from "@/lib/foundation/reference-catalogue";
import { foundationVerificationStatusSchema } from "@/lib/foundation/verification-status";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import type { z } from "zod";
const style = "mt-1 w-full rounded-lg border bg-background p-3";
async function fetchVerificationStatus() {
  const response = await fetch("/api/foundation/verification", {
    cache: "no-store",
    redirect: "error",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Sign in to verify your account"
        : "Verification status could not be loaded"
    );
  return foundationVerificationStatusSchema.parse(data);
}
function VerificationBody() {
  const [status, setStatus] = useState<z.infer<typeof foundationVerificationStatusSchema>>();
  const [reference, setReference] = useState<FoundationReferenceCatalogue>();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refresh() {
    setStatus(await fetchVerificationStatus());
  }
  useEffect(() => {
    Promise.all([
      fetchVerificationStatus().then(setStatus),
      readFoundationReferenceCatalogue(getFoundationBrowserClient()).then(setReference),
    ]).catch((error) =>
      setMessage(error instanceof Error ? error.message : "Verification could not be loaded")
    );
  }, []);
  async function send(path: string, body: object | FormData) {
    setBusy(true);
    setMessage("");
    try {
      await ensureCsrfTokenReady();
      const multipart = body instanceof FormData;
      const response = await fetch(path, {
        method: "POST",
        headers: withCsrfHeaders(multipart ? undefined : { "Content-Type": "application/json" }),
        body: multipart ? body : JSON.stringify(body),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "The verification step could not be completed"
        );
      await refresh();
      return data;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The result could not be confirmed. Refresh your status before trying again."
      );
      return null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main id="main-content" className="container-page max-w-3xl flex-1 space-y-7 py-8">
        <header>
          <h1 className="font-display text-3xl font-bold">Verify your account</h1>
          <p className="mt-3 text-muted-foreground">
            Confirm your phone and location, then submit your identity document and selfie for
            manual review. Documents are encrypted and only accessible to authorised reviewers.
          </p>
          <p className="mt-2 text-sm">
            <Link href="/dashboard/profile" className="text-primary underline">
              Enter your legal first and last names in your profile
            </Link>{" "}
            before submitting identity documents.
          </p>
        </header>
        {message && (
          <p role="status" className="rounded-xl border bg-card p-4">
            {message}
          </p>
        )}
        <section className="space-y-4 rounded-2xl border bg-card p-6">
          <h2 className="text-xl font-semibold">
            1. Mobile number {status?.phone_verified ? "— verified" : ""}
          </h2>
          {!status?.phone_verified && (
            <>
              <form
                className="space-y-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const result = await send("/api/foundation/phone/send", { phone });
                  if (result && typeof result.challenge_id === "string") {
                    setChallenge(result.challenge_id);
                    setMessage("A verification code was sent to your mobile.");
                  }
                }}
              >
                <label className="block">
                  South African mobile number
                  <input
                    required
                    type="tel"
                    maxLength={12}
                    placeholder="+27821234567"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className={style}
                  />
                </label>
                <button disabled={busy} className="rounded-lg border px-4 py-3">
                  Send verification code
                </button>
              </form>
              {challenge && (
                <form
                  className="space-y-3"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const result = await send("/api/foundation/phone/verify", {
                      challenge_id: challenge,
                      code,
                    });
                    if (result) {
                      setCode("");
                      setChallenge("");
                      setMessage("Mobile number verified.");
                    }
                  }}
                >
                  <label className="block">
                    Six-digit code
                    <input
                      required
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      className={style}
                    />
                  </label>
                  <button
                    disabled={busy}
                    className="rounded-lg bg-primary px-4 py-3 text-primary-foreground"
                  >
                    Verify number
                  </button>
                </form>
              )}
            </>
          )}
        </section>
        <section className="space-y-4 rounded-2xl border bg-card p-6">
          <h2 className="text-xl font-semibold">
            2. Location {status?.locality_confirmed ? "— confirmed" : ""}
          </h2>
          {!status?.locality_confirmed && reference && (
            <form
              className="space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const result = await send("/api/foundation/verification/location", {
                  province,
                  city,
                });
                if (result) setMessage("Your location was saved.");
              }}
            >
              <label className="block">
                Province
                <select
                  required
                  value={province}
                  onChange={(event) => {
                    setProvince(event.target.value);
                    setCity("");
                  }}
                  className={style}
                >
                  <option value="">Choose a province</option>
                  {reference.provinces.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                City or town
                <select
                  required
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  className={style}
                >
                  <option value="">Choose a city</option>
                  {reference.cities
                    .filter((row) => row.province === province)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label}
                      </option>
                    ))}
                </select>
              </label>
              <button disabled={busy} className="rounded-lg border px-4 py-3">
                Confirm location
              </button>
            </form>
          )}
        </section>
        <section className="space-y-4 rounded-2xl border bg-card p-6">
          <h2 className="text-xl font-semibold">
            3. Identity{" "}
            {status?.verified
              ? "— reviewed"
              : status?.submission_pending
                ? "— waiting for review"
                : ""}
          </h2>
          {status?.return_reason && (
            <p className="rounded-lg border p-3">Reviewer feedback: {status.return_reason}</p>
          )}
          {!status?.verified && !status?.submission_pending && (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                form.set("id_number", idNumber);
                const result = await send("/api/foundation/verification", form);
                if (result) {
                  setIdNumber("");
                  setMessage("Your documents were submitted for manual review.");
                }
              }}
            >
              <label className="block">
                South African ID number
                <input
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  type="password"
                  pattern="[0-9]{13}"
                  maxLength={13}
                  value={idNumber}
                  onChange={(event) => setIdNumber(event.target.value)}
                  className={style}
                />
              </label>
              <label className="block">
                Clear image of the front of your ID
                <input
                  required
                  name="document"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  capture="environment"
                  className={style}
                />
              </label>
              <label className="block">
                Current selfie
                <input
                  required
                  name="selfie"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="user"
                  className={style}
                />
              </label>
              <p className="text-sm text-muted-foreground">
                Each file must be under 5 MB. Your number, names and selfie will be independently
                compared with your document. Higher-risk submissions require a second reviewer.
              </p>
              <button
                disabled={busy}
                className="rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Submitting…" : "Submit identity documents"}
              </button>
            </form>
          )}
          {status?.submission_pending && (
            <p className="text-muted-foreground">
              Your documents are in the review queue. Please wait for a decision before submitting
              another set.
            </p>
          )}
        </section>
        <div className="flex flex-wrap gap-4">
          <button
            className="rounded-lg border px-4 py-3"
            disabled={busy}
            onClick={() =>
              void refresh().catch(() => setMessage("Your status could not be refreshed"))
            }
          >
            Refresh status
          </button>
          <Link className="rounded-lg border px-4 py-3" href="/dashboard">
            Return to dashboard
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function FoundationVerificationPage() {
  return (
    <FoundationAccountBoundary>
      <VerificationBody />
    </FoundationAccountBoundary>
  );
}
