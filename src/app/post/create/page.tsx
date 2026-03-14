import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { PostCreateClient } from "./post-create-client";

export const metadata = {
  title: "Choose What to Post",
  description:
    "Choose the right posting area for a listing, business profile, or Promotions & Events campaign on VerifyMzansi.",
};

export default function PostCreatePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6 space-y-4">
          <PageHeader
            title="Choose What to Post"
            description="Pick the area that fits your goal: a listing, a business profile, or a Promotions & Events campaign."
            breadcrumbs={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Choose What to Post" },
            ]}
          />

          <PostCreateClient />
        </div>
      </main>

      <Footer />
    </div>
  );
}
