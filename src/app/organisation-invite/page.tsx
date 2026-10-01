import { createHash } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { InfoHero } from "@/components/safety/info-hero";
import { Button } from "@/components/ui/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AcceptInviteButton } from "./accept-invite-button";

export const metadata: Metadata = {
  title: "Programme administrator invitation",
  robots: { index: false, follow: false },
  // The invitation token is in the URL; never pass it on to other sites.
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

type Preview = {
  organisationName: string;
  organisationSlug: string;
  email: string;
  expiresAt: string;
  status: "open" | "used" | "revoked" | "expired" | "inactive";
};

const STATUS_COPY: Record<Exclude<Preview["status"], "open">, string> = {
  used: "This invitation has already been accepted.",
  revoked: "This invitation was replaced or withdrawn. Ask VerifyMzansi for a new link.",
  expired: "This invitation has expired. Ask VerifyMzansi for a new link.",
  inactive: "This programme is not active at the moment.",
};

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

/**
 * Landing page for a sponsor administrator invitation. Opening the link only
 * shows what is being offered; acceptance needs a signed-in, identity-reviewed
 * member using the invited email address and an explicit click.
 */
export default async function OrganisationInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{20,200}$/.test(token);
  const preview = valid
    ? ((
        await createAdminClient().rpc("organisation_invite_preview", {
          p_token_hash: createHash("sha256").update(token).digest("hex"),
        })
      ).data as Preview | null)
    : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("account_profiles")
        .select("account_verification_status")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };
  const returnUrl = encodeURIComponent(`/organisation-invite?token=${token ?? ""}`);
  const emailMatches = Boolean(
    user?.email && preview && user.email.toLowerCase() === preview.email
  );
  const verified = profile?.account_verification_status === "verified";

  let body: React.ReactNode;
  if (!preview) {
    body = (
      <p className="text-muted-foreground">
        This invitation link is not valid. Check that you copied the whole link from the email.
      </p>
    );
  } else if (preview.status !== "open") {
    body = <p className="text-muted-foreground">{STATUS_COPY[preview.status]}</p>;
  } else if (!user) {
    body = (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Sign in with <strong>{preview.email}</strong> to continue. New to VerifyMzansi? Create an
          account with that email and complete identity review, then open the link in the invitation
          email again — it stays valid until it expires.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild className="h-11 rounded-full">
            <Link href={`/login?returnUrl=${returnUrl}`}>Sign in</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 rounded-full">
            <Link href="/register">Create an account</Link>
          </Button>
        </div>
      </div>
    );
  } else if (!emailMatches) {
    body = (
      <p className="text-muted-foreground">
        You are signed in with a different email address. This invitation was sent to{" "}
        <strong>{preview.email}</strong>. Sign out and sign in with that address to accept it.
      </p>
    );
  } else if (!verified) {
    body = (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Programme administrators must complete VerifyMzansi identity review first. Come back to
          this link once your review is approved.
        </p>
        <Button asChild className="h-11 rounded-full">
          <Link href="/verification">Complete identity review</Link>
        </Button>
      </div>
    );
  } else {
    body = (
      <AcceptInviteButton token={token as string} organisationName={preview.organisationName} />
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1 scroll-mt-24">
        <InfoHero
          title={preview ? `Manage ${preview.organisationName}` : "Programme invitation"}
          description="Programme administrators approve which businesses join, manage supported places and download activity reports."
          breadcrumbs={[{ label: "Programme invitation" }]}
        />
        <section className="container-page max-w-2xl space-y-5 py-10">
          {preview?.status === "open" ? (
            <dl className="grid gap-3 rounded-2xl border p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Invitation sent to</dt>
                <dd className="break-all font-semibold">{preview.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Link expires</dt>
                <dd className="font-semibold">{date.format(new Date(preview.expiresAt))} SAST</dd>
              </div>
            </dl>
          ) : null}
          {body}
          <p className="text-xs text-muted-foreground">
            Administrators never see identity documents, selfies, phone numbers of individuals or
            private messages.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
