import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";
import { createClient } from "@/lib/supabase/server";
import { PostCreateClient } from "./post-create-client";

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

      <main id="main-content" className="flex-1">
        <div className="container-page space-y-6 py-6 sm:py-8">
          <PageHeader
            title="What would you like to post?"
            description="Tap the option that fits best. The form opens ready for it, and we check every post before it goes live."
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Create Post" }]}
          />

          <PostCreateClient initialVerificationStatus={initialVerificationStatus} isAuthenticated />
        </div>
      </main>

      <Footer />
    </div>
  );
}
