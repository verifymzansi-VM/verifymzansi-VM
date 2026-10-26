import { FoundationAccountBoundary } from "@/components/auth/foundation-account-boundary";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
import { readFoundationInboxCounts } from "@/lib/foundation/owner-inbox";
import { readFoundationVerificationReadiness } from "@/lib/foundation/verification-readiness";

const post = z.object({
  id: z.uuid(),
  kind: z.enum(["listing", "business", "event"]),
  area: z.enum(["market", "business", "tourism_events"]),
  title: z.string().nullable(),
  status: z.string(),
  revision: z.number().int().positive(),
});
const postPage = z.object({
  items: z.array(post).max(48),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export async function FoundationDashboard() {
  let current: Awaited<ReturnType<typeof readFoundationServerSession>>;
  try {
    current = await readFoundationServerSession();
  } catch (error) {
    if (error instanceof FoundationServerSessionError && error.status === 401) redirect("/login");
    throw new Error("Your dashboard could not be loaded");
  }
  const [posts, inbox, readiness] = await Promise.all([
    current.api.rpc("list_my_posts", { p_limit: 6, p_offset: 0 }).then(({ data, error }) => {
      if (error) throw new Error("Your posts could not be loaded");
      return postPage.parse(data);
    }),
    readFoundationInboxCounts(current.api),
    readFoundationVerificationReadiness(current.api),
  ]);
  const name =
    current.account.profile.public_name ?? current.account.profile.display_name ?? "Member";
  const sections = [
    { href: "/dashboard/listings", label: "Your posts", value: posts.total },
    { href: "/dashboard/leads", label: "Unread enquiries", value: inbox.unread_enquiries },
    {
      href: "/dashboard/communication",
      label: "Unread notifications",
      value: inbox.unread_notifications,
    },
  ];
  return (
    <FoundationAccountBoundary accountId={current.account.account_id}>
      <div className="space-y-8">
        <header className="space-y-2">
          <h1 className="font-display text-2xl font-bold">Welcome, {name}</h1>
          <p className="text-muted-foreground">Manage your posts, enquiries and account.</p>
        </header>
        <div className="grid gap-4 sm:grid-cols-3">
          {sections.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-lg border p-5 hover:bg-muted">
              <p className="text-sm text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-2xl font-bold">{item.value}</p>
            </Link>
          ))}
        </div>
        <section className="space-y-3 rounded-lg border p-5">
          <h2 className="text-lg font-semibold">Account verification</h2>
          <p>
            {current.account.profile.identity_verified
              ? "Your identity is verified."
              : "Complete identity review to publish your posts."}
          </p>
          <p className="text-sm">
            Phone: {readiness.phone_verified ? "verified" : "not verified"} · Location:{" "}
            {readiness.locality_confirmed ? "confirmed" : "not confirmed"}
          </p>
          <div className="flex flex-wrap gap-4">
            <Link className="underline" href="/dashboard/complete-profile">
              Phone verification
            </Link>
            <Link className="underline" href="/verification">
              Identity and location
            </Link>
            <Link className="underline" href="/dashboard/profile">
              Profile settings
            </Link>
          </div>
        </section>
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent posts</h2>
            <Link className="underline" href="/post/create">
              Create a post
            </Link>
          </div>
          {posts.items.length === 0 ? (
            <p>You have no posts yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {posts.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{item.title || "Untitled draft"}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.kind} · {item.status.replaceAll("_", " ")}
                    </p>
                  </div>
                  <Link
                    className="underline"
                    href={`/post/${item.kind === "listing" ? "edit-listing" : item.area === "tourism_events" ? "edit-tourism" : "edit-business"}/${item.id}`}
                  >
                    Manage
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </FoundationAccountBoundary>
  );
}
