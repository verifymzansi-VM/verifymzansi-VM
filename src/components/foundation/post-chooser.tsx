import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { FoundationAccountBoundary } from "@/components/auth/foundation-account-boundary";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
import { readFoundationVerificationReadiness } from "@/lib/foundation/verification-readiness";
const choices = [
  {
    title: "Mzansi Market",
    text: "Sell an item, advertise a rental or list a job vacancy.",
    href: "/post/create-listing",
  },
  {
    title: "Mzansi Business",
    text: "Create a profile for your shop, trade or professional service.",
    href: "/post/create-business",
  },
  {
    title: "Tourism",
    text: "List a stay, attraction, tour or visitor experience.",
    href: "/post/create-tourism?type=tourism_business",
  },
  {
    title: "Events",
    text: "Share an upcoming event. Event posts are free.",
    href: "/post/create-tourism?type=event",
  },
];
export async function FoundationPostChooser() {
  const current = await readFoundationServerSession().catch((error) => {
    redirect(
      error instanceof FoundationServerSessionError && error.status === 401
        ? "/login?returnUrl=%2Fpost%2Fcreate"
        : "/error?reason=unavailable"
    );
  });
  const verification = await readFoundationVerificationReadiness(current.api);
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main id="main-content" className="container-page flex-1 space-y-7 py-8">
        <FoundationAccountBoundary accountId={current.account.account_id}>
          <div className="space-y-6">
            <header>
              <h1 className="font-display text-3xl font-bold">What would you like to post?</h1>
              <p className="mt-3 text-muted-foreground">
                Choose a section, save a draft and send it for review when it is ready.
              </p>
            </header>
            {!verification.verification_ready && (
              <p className="rounded-xl border bg-card p-5">
                You can prepare a draft now.{" "}
                <Link className="underline" href="/verification">
                  Complete identity, phone and location verification
                </Link>{" "}
                before submitting it.
              </p>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              {choices.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className="space-y-3 rounded-2xl border bg-card p-6 transition-colors hover:border-primary"
                >
                  <h2 className="font-display text-xl font-bold">{item.title}</h2>
                  <p className="text-muted-foreground">{item.text}</p>
                  <span className="inline-block font-semibold text-primary">Create a draft →</span>
                </Link>
              ))}
            </div>
            <Link className="inline-block underline" href="/dashboard/listings">
              Back to your posts
            </Link>
          </div>
        </FoundationAccountBoundary>
      </main>
      <Footer />
    </div>
  );
}
