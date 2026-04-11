import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MobileNav } from "@/components/layout/mobile-nav";

export default function PostNotFound() {
  return (
    <div className="flex min-h-screen flex-col pb-16 md:pb-0">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <FileQuestion className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="text-lg sm:text-xl font-display font-bold">Post Not Found</h1>
          <p className="text-sm text-muted-foreground">
            This post page doesn&apos;t exist. You can create a new post or return to your
            dashboard.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
          <Button asChild>
            <Link href="/post/create">Create a Post</Link>
          </Button>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
