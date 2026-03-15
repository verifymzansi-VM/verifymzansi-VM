import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";
import { createClient } from "@/lib/supabase/server";
import { PostCreateClient } from "./post-create-client";

export const metadata = {
  title: "Create a Post",
  description: "Choose the right posting category on VerifyMzansi.",
};

export default async function PostCreatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const initialVerificationStatus = user
    ? (
        await resolveAccountVerification(supabase, user.id, {
          includeStepsWhenVerified: true,
        })
      ).accountVerificationStatus
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated={Boolean(user)} />

      <main className="flex-1">
        <div className="container-page py-6 space-y-4">
          <PageHeader
            title="Create a Post"
            description="Pick a category to start posting."
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Create Post" }]}
          />

          <PostCreateClient
            initialVerificationStatus={initialVerificationStatus}
            isAuthenticated={Boolean(user)}
          />
        </div>
      </main>

      <Footer />
    </div>
  );
}
