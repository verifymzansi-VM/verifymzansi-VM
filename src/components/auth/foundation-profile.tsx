"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/stores/auth-store";
import { signOutBrowserSession } from "@/hooks/use-auth";
import { fetchFoundationAccountSession } from "@/lib/foundation/account-session-client";
import type { FoundationAccountContext } from "@/lib/foundation/account-context";
import {
  foundationAccountProfileSchema,
  buildFoundationProfileUpdate,
  buildFoundationLegalNameClaim,
} from "@/lib/foundation/account-profile";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { createTimeoutFetch } from "@/lib/supabase/fetch-with-timeout";

/** The foundation profile never queries a legacy table or treats editable
 * Auth metadata as a verified identity. Commands are revision fenced in SQL. */
export function FoundationProfile() {
  const currentId = useAuthStore((state) => state.user?.id);
  return <FoundationProfileAccount key={currentId ?? "anonymous"} currentId={currentId} />;
}
function FoundationProfileAccount({ currentId }: { currentId?: string }) {
  const router = useRouter();
  const [account, setAccount] = useState<FoundationAccountContext | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void fetchFoundationAccountSession().then(
      (value) => {
        if (cancelled) return;
        if (!value) {
          router.replace("/login?returnUrl=%2Fdashboard%2Fprofile");
          return;
        }
        if (value.account_id !== currentId || useAuthStore.getState().user?.id !== currentId)
          return;
        setAccount(value);
        setDisplayName(value.profile.display_name ?? "");
        setBio(value.profile.bio ?? "");
        setFirstName(value.profile.legal_first_name ?? "");
        setLastName(value.profile.legal_last_name ?? "");
        setLoading(false);
      },
      () => {
        if (!cancelled) {
          setLoading(false);
          setFailed(true);
          setMessage("Your profile could not be loaded. Try again.");
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [currentId, reload, router]);
  const sameAccount = () => account && useAuthStore.getState().user?.id === account.account_id;
  async function command(path: string, body: unknown) {
    if (!sameAccount() || !(await ensureCsrfTokenReady()) || !sameAccount()) throw new Error();
    const response = await createTimeoutFetch(20000)(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!sameAccount()) return;
    if (!response.ok) {
      if (response.status === 409)
        throw new Error("Your profile changed. Reload it before saving.");
      throw new Error("Your profile could not be saved. Check the details and try again.");
    }
    const profile = foundationAccountProfileSchema.parse(value);
    setAccount((old) => (old ? { ...old, profile } : null));
  }
  async function save(event: FormEvent, legal: boolean) {
    event.preventDefault();
    if (!account || busy || !sameAccount()) return;
    setBusy(true);
    setMessage(null);
    try {
      if (legal) {
        buildFoundationLegalNameClaim({
          expected_revision: account.profile.revision,
          first_name: firstName,
          last_name: lastName,
        });
        await command("/api/foundation/profile/legal-name", {
          expected_revision: account.profile.revision,
          first_name: firstName,
          last_name: lastName,
        });
      } else {
        buildFoundationProfileUpdate({
          expected_revision: account.profile.revision,
          display_name: account.profile.legal_name_locked ? null : displayName,
          bio,
        });
        await command("/api/foundation/profile", {
          expected_revision: account.profile.revision,
          display_name: account.profile.legal_name_locked ? null : displayName,
          bio,
        });
      }
      if (sameAccount()) {
        setFailed(false);
        setMessage("Profile saved.");
      }
    } catch (error) {
      if (sameAccount()) {
        setFailed(true);
        setMessage(
          error instanceof Error &&
            !(error instanceof z.ZodError) &&
            /^(Your profile)/.test(error.message)
            ? error.message
            : "Check your name and profile details before saving."
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function avatar(file?: File) {
    if (!file || !account || busy || !sameAccount()) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setFailed(true);
      setMessage("Choose an image up to 10 MB.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!(await ensureCsrfTokenReady()) || !sameAccount()) throw new Error();
      const body = new FormData();
      body.append("files", file);
      body.append("content_type", "avatar");
      const response = await createTimeoutFetch(60000)("/api/media/upload", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: withCsrfHeaders(),
        body,
      });
      const result = await response.json();
      if (!sameAccount()) return;
      const objectId = z.uuid().parse(result?.objects?.[0]?.object_id);
      if (!response.ok || result?.objects?.[0]?.kind !== "image") throw new Error();
      await command("/api/foundation/profile/avatar", {
        expected_revision: account.profile.revision,
        object_id: objectId,
      });
      if (sameAccount()) {
        setFailed(false);
        setMessage("Profile picture saved.");
      }
    } catch {
      if (sameAccount()) {
        setFailed(true);
        setMessage("The picture could not be saved. Reload before trying again.");
      }
    } finally {
      setBusy(false);
    }
  }
  if (loading || (account && account.account_id !== currentId))
    return <p role="status">Loading your profile…</p>;
  if (!account)
    return (
      <div className="space-y-3">
        <p role="alert">{message}</p>
        <Button onClick={() => setReload((value) => value + 1)}>Retry</Button>
      </div>
    );
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold">My profile</h1>
        <p className="text-muted-foreground">Manage the details shown with your posts.</p>
      </header>
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
      <form onSubmit={(event) => void save(event, false)} className="space-y-4">
        <div>
          <Label htmlFor="foundation-display-name">Display name</Label>
          <Input
            id="foundation-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={busy || account.profile.legal_name_locked}
            maxLength={100}
          />
        </div>
        {account.profile.legal_name_locked && (
          <p className="text-sm">Your reviewed name is locked to your verified identity.</p>
        )}
        <div>
          <Label htmlFor="foundation-profile-bio">About you</Label>
          <Textarea
            id="foundation-profile-bio"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            disabled={busy}
            maxLength={300}
          />
        </div>
        <Button disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button>
      </form>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Profile picture</h2>
        <Label htmlFor="foundation-avatar">Upload a new picture</Label>
        <Input
          id="foundation-avatar"
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(event) => void avatar(event.target.files?.[0])}
        />
      </section>
      <form onSubmit={(event) => void save(event, true)} className="space-y-4">
        <h2 className="text-lg font-semibold">Identity details</h2>
        <p className="text-sm text-muted-foreground">
          These names are private. They become verified only after identity review.
        </p>
        <div>
          <Label htmlFor="foundation-first-name">Legal first name</Label>
          <Input
            id="foundation-first-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            disabled={busy || account.profile.legal_name_locked}
          />
        </div>
        <div>
          <Label htmlFor="foundation-last-name">Legal surname</Label>
          <Input
            id="foundation-last-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            disabled={busy || account.profile.legal_name_locked}
          />
        </div>
        {!account.profile.legal_name_locked && (
          <Button disabled={busy}>Save identity details</Button>
        )}
        <p>
          {account.profile.identity_verified ? "Identity verified" : "Identity not yet verified"}
        </p>
        <Link href="/verification" className="underline">
          Manage verification
        </Link>
      </form>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Account and security</h2>
        <p>Email: {account.email}</p>
        <p>Verified phone: {account.phone ?? "Not yet verified"}</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/dashboard/complete-profile" className="underline">
            Verify or change phone
          </Link>
          <Link href="/dashboard/security" className="underline">
            Password and authenticator
          </Link>
          <Link href="/dsar" className="underline">
            Data and account requests
          </Link>
        </div>
        <Button variant="outline" onClick={() => void signOutBrowserSession()}>
          Sign out
        </Button>
      </section>
    </div>
  );
}
