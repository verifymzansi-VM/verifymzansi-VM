import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BrandSurface } from "@/components/brand";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { PostCreateClient } from "./post-create-client";

// How a post goes live, shown beside the headline on wide screens.
const STEPS = ["Choose a section", "Fill in the form", "We check it, then it goes live"] as const;

export const metadata = {
  title: "Create a Post",
  description: "Post an item, a business profile, or a stay or event on VerifyMzansi.",
};

export default async function PostCreatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?returnUrl=%2Fpost%2Fcreate");
  }

  const initialVerificationStatus = (
    await resolveAccountVerification(supabase, user.id, {
      includeStepsWhenVerified: true,
    })
  ).accountVerificationStatus;

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      {/* On desktop the chooser fills the first screen, below the header. */}
      <main id="main-content" className="flex flex-1 flex-col lg:min-h-[calc(100dvh-4.25rem)]">
        <BrandSurface as="section" aria-labelledby="post-create-title">
          <div className="container-page flex flex-col gap-4 pb-7 pt-4 lg:flex-row lg:items-end lg:justify-between lg:gap-10 lg:pb-8">
            <div className="min-w-0">
              <Breadcrumbs
                items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Create Post" }]}
                tone="inverse"
              />
              <h1
                id="post-create-title"
                className="mt-2 font-display text-[2rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-white sm:text-[2.6rem]"
              >
                What would you like <span className="gold-shine text-brand-gold-300">to post?</span>
              </h1>
              <p className="mt-2 max-w-2xl text-base leading-7 text-white/75">
                Each card is a section of the site. Pick the one your post belongs in.
              </p>
            </div>

            <ol
              className="hidden shrink-0 items-center gap-2 lg:flex"
              aria-label="How posting works"
            >
              {STEPS.map((step, index) => (
                <li
                  key={step}
                  style={{ "--i": index } as CSSProperties}
                  aria-current={index === 0 ? "step" : undefined}
                  className={cn(
                    "rise-in chip-pop flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 text-sm font-medium text-white/90",
                    index === 0
                      ? "border-brand-gold-300/40 bg-brand-gold-300/10"
                      : "border-white/10 bg-white/[0.04]"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full bg-brand-gold-300/15 font-display text-xs font-bold text-brand-gold-300",
                      index === 0 && "pulse-ring"
                    )}
                  >
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </BrandSurface>

        <div className="container-page flex flex-1 flex-col py-5">
          <PostCreateClient initialVerificationStatus={initialVerificationStatus} isAuthenticated />
        </div>
      </main>

      <Footer />
    </div>
  );
}
