import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { PostCreateClient } from "./post-create-client";

export const metadata = {
  title: "Create a Post",
  description: "Choose the right posting category on VerifyMzansi.",
};

export default function PostCreatePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6 space-y-4">
          <PageHeader
            title="Create a Post"
            description="Pick a category to start posting."
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Create Post" }]}
          />

          <PostCreateClient />
        </div>
      </main>

      <Footer />
    </div>
  );
}
