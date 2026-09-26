import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export default function PostNotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main
        id="main-content"
        className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-12 text-center"
      >
        <span className="empty-state-icon">
          <FileQuestion className="h-7 w-7" aria-hidden="true" />
        </span>
        <div className="max-w-sm space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">Post not found</h1>
          <p className="text-sm text-muted-foreground">
            It may have been removed, or the link is wrong.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-2 sm:max-w-none sm:flex-row sm:justify-center">
          <Button asChild variant="trust-verified" className="h-11 rounded-full px-6">
            <Link href="/post/create">Create a post</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 rounded-full px-6">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
