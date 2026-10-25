import Link from "next/link";
import { FoundationAccountBoundary } from "@/components/auth/foundation-account-boundary";
import { redirect } from "next/navigation";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
import {
  listFoundationOwnerPosts,
  foundationPostEditPath,
  foundationPostPath,
  type FoundationOwnerPost,
} from "@/lib/foundation/owner-posts";
import { FoundationOwnerPostActions } from "./owner-post-actions";
import { readFoundationBillingCatalogue } from "@/lib/foundation/billing-catalogue";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";

export async function FoundationOwnerPostList({ offset = 0 }: { offset?: number }) {
  let current;
  try {
    current = await readFoundationServerSession();
  } catch (error) {
    if (error instanceof FoundationServerSessionError && error.status === 401) redirect("/login");
    throw error;
  }
  const [page, catalogue] = await Promise.all([
    listFoundationOwnerPosts(current.api, 48, offset),
    readFoundationBillingCatalogue(foundationServerPublicApi()),
  ]);
  return (
    <FoundationAccountBoundary accountId={current.account.account_id}>
      <div className="space-y-7">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold">Your posts</h1>
            <p className="mt-2 text-muted-foreground">
              {page.total} saved {page.total === 1 ? "post" : "posts"}
            </p>
          </div>
          <Link
            className="rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground"
            href="/post/create"
          >
            Create a post
          </Link>
        </header>
        {!page.items.length && (
          <section className="rounded-2xl border bg-card p-8">
            <h2 className="text-lg font-semibold">Create your first post</h2>
            <p className="mt-2 text-muted-foreground">
              Your drafts and published posts will appear here.
            </p>
          </section>
        )}
        <div className="grid gap-4">
          {page.items.map((post: FoundationOwnerPost) => (
            <article
              key={post.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5"
            >
              <div>
                <h2 className="font-semibold">{post.title ?? "Untitled draft"}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {post.status.replaceAll("_", " ")} · {post.area.replaceAll("_", " ")}
                  {post.visible_until
                    ? ` · Visibility ends ${new Date(post.visible_until).toLocaleDateString("en-ZA")}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={foundationPostEditPath(post)} className="rounded-lg border px-4 py-2">
                  Manage
                </Link>
                {post.status === "live" && (
                  <Link href={foundationPostPath(post)} className="rounded-lg border px-4 py-2">
                    View
                  </Link>
                )}
                <FoundationOwnerPostActions
                  post={post}
                  addons={catalogue.addons}
                  accountId={current.account.account_id}
                />
              </div>
            </article>
          ))}
        </div>
        <nav aria-label="Post pages" className="flex gap-4">
          {offset > 0 && (
            <Link
              href={`/dashboard/listings?offset=${Math.max(0, offset - page.limit)}`}
              className="underline"
            >
              Previous page
            </Link>
          )}
          {offset + page.items.length < page.total && (
            <Link href={`/dashboard/listings?offset=${offset + page.limit}`} className="underline">
              Next page
            </Link>
          )}
        </nav>
      </div>
    </FoundationAccountBoundary>
  );
}
