import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import { searchFoundationCards, foundationMediaUrl } from "@/lib/foundation/public-cards";
import { readFoundationReferenceCatalogue } from "@/lib/foundation/reference-catalogue";
import { readFoundationPublicPost } from "@/lib/foundation/public-post";
import { FoundationContact } from "./public-contact";
import { ReportDialog } from "@/components/shared/report-dialog";
import type { Metadata } from "next";

type Area = "market" | "business" | "tourism_events";
type Query = Record<string, string | string[] | undefined>;
const sections = {
  market: { title: "Mzansi Market", path: "/mzansi-market", create: "/post/create-listing" },
  business: { title: "Mzansi Business", path: "/mzansi-business", create: "/post/create-business" },
  tourism_events: {
    title: "Tourism & Events",
    path: "/tourism-events",
    create: "/post/create-tourism",
  },
};
const single = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;
export function foundationPrice(post: {
  price_mode: string | null;
  price_cents: string | null;
  price_negotiable?: boolean;
}) {
  if (post.price_mode === "free") return "Free";
  if (post.price_mode === "on_request") return "Price on request";
  if (post.price_cents === null) return "";
  return (
    new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
      Number(post.price_cents) / 100
    ) + (post.price_negotiable ? " · Negotiable" : "")
  );
}
export async function FoundationMarketplace({
  area,
  searchParams,
}: {
  area: Area;
  searchParams?: Promise<Query>;
}) {
  const query = (await searchParams) ?? {};
  const api = foundationServerPublicApi();
  const reference = await readFoundationReferenceCatalogue(api);
  const category = single(query.category);
  const province = single(query.province);
  const input = {
    area,
    limit: 24,
    ...(single(query.q) ? { q: single(query.q) } : {}),
    ...(reference.categories.some((row) => row.area === area && row.key === category)
      ? { category }
      : {}),
    ...(reference.provinces.some((row) => row.id === province) ? { province } : {}),
    ...(single(query.cursor) ? { cursor: single(query.cursor) } : {}),
  };
  const page = await searchFoundationCards(api, input);
  const section = sections[area];
  const next = new URLSearchParams();
  for (const name of ["q", "category", "province"]) {
    const value = single(query[name]);
    if (value) next.set(name, value);
  }
  if (page.next_cursor) next.set("cursor", page.next_cursor);
  return (
    <div className="container-page space-y-8 py-8 lg:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">{section.title}</h1>
          <p className="mt-2 text-muted-foreground">
            Discover local posts from ID-reviewed members across South Africa.
          </p>
        </div>
        <Link
          className="rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground"
          href={section.create}
        >
          Create a post
        </Link>
      </header>
      <form method="get" className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-4">
        <label className="text-sm">
          Search
          <input
            className="mt-1 h-11 w-full rounded-lg border bg-background px-3"
            name="q"
            maxLength={200}
            defaultValue={single(query.q)}
          />
        </label>
        <label className="text-sm">
          Category
          <select
            className="mt-1 h-11 w-full rounded-lg border bg-background px-3"
            name="category"
            defaultValue={category ?? ""}
          >
            <option value="">All categories</option>
            {reference.categories
              .filter((row) => row.area === area)
              .map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm">
          Province
          <select
            className="mt-1 h-11 w-full rounded-lg border bg-background px-3"
            name="province"
            defaultValue={province ?? ""}
          >
            <option value="">All provinces</option>
            {reference.provinces.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="mt-auto h-11 rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
          type="submit"
        >
          Find posts
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        {page.total} {page.total === 1 ? "post" : "posts"} found
      </p>
      {page.items.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {page.items.map((post) => {
            const image = foundationMediaUrl(post.preview.image_key);
            return (
              <Link
                key={post.id}
                href={`${post.kind === "listing" ? "/listing" : sections[post.area].path}/${post.id}`}
                className="overflow-hidden rounded-2xl border bg-card transition-colors hover:border-primary"
              >
                {image ? (
                  <Image
                    src={image}
                    alt={post.title}
                    width={640}
                    height={480}
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-muted px-5 text-center text-muted-foreground">
                    {reference.categories.find((row) => row.key === post.category)?.label ??
                      section.title}
                  </div>
                )}
                <div className="space-y-2 p-4">
                  <h2 className="font-semibold">{post.title}</h2>
                  {post.kind === "listing" && (
                    <p className="font-semibold text-primary">{foundationPrice(post)}</p>
                  )}
                  <p className="line-clamp-2 text-sm text-muted-foreground">{post.summary}</p>
                  <p className="text-xs text-muted-foreground">{post.locality}</p>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border bg-card p-8 text-center">
          <h2 className="text-xl font-semibold">No matching posts yet</h2>
          <p className="mt-2 text-muted-foreground">
            Try a different search or create a post in this section.
          </p>
        </div>
      )}
      {page.next_cursor && (
        <Link
          className="inline-flex rounded-full border px-6 py-3"
          href={`${section.path}?${next}`}
        >
          Next page
        </Link>
      )}
    </div>
  );
}
export async function foundationPublicMetadata(id: string, area?: Area): Promise<Metadata> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return { title: "Post not found" };
  const post = await readFoundationPublicPost(foundationServerPublicApi(), { id });
  if (!post || (area && post.area !== area)) return { title: "Post not found" };
  return { title: post.title, description: post.description?.slice(0, 160) ?? undefined };
}
export async function FoundationPublicDetail({ id, area }: { id: string; area?: Area }) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const api = foundationServerPublicApi();
  const post = await readFoundationPublicPost(api, { id });
  if (!post) notFound();
  if (area && post.area !== area) {
    if (area === "business" && post.area === "tourism_events" && post.kind === "business")
      redirect(`/tourism-events/${post.id}`);
    notFound();
  }
  const { data: channels, error } = await api.rpc("get_public_contact_channels", {
    p_post_id: post.id,
  });
  if (error) throw new Error("Contact options could not be loaded");
  const allowed = Array.isArray(channels)
    ? channels.filter(
        (value): value is "call" | "whatsapp" | "form" =>
          value === "call" || value === "whatsapp" || value === "form"
      )
    : [];
  return (
    <main className="container-page space-y-7 py-8">
      <Link className="text-sm text-primary" href={sections[post.area].path}>
        Back to {sections[post.area].title}
      </Link>
      <header>
        <h1 className="font-display text-3xl font-bold">{post.title}</h1>
        <p className="mt-2 text-muted-foreground">{post.locality}</p>
        {post.kind === "listing" && (
          <p className="mt-3 text-2xl font-bold text-primary">{foundationPrice(post)}</p>
        )}
      </header>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {post.media.map((item) => {
              const url = foundationMediaUrl(item.object_key);
              return (
                url &&
                (item.kind === "video" ? (
                  <video
                    key={`${item.purpose}/${item.position}`}
                    src={url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full rounded-xl"
                  />
                ) : (
                  <Image
                    key={`${item.purpose}/${item.position}`}
                    src={url}
                    alt={post.title}
                    width={item.width ?? 1000}
                    height={item.height ?? 750}
                    className="h-auto w-full rounded-xl object-cover"
                  />
                ))
              );
            })}
          </div>
          <p className="whitespace-pre-wrap rounded-2xl border bg-card p-6 leading-relaxed">
            {post.description}
          </p>
          {post.event_window && (
            <p className="rounded-xl border p-4">
              {new Date(post.event_window.starts_at).toLocaleString("en-ZA", {
                timeZone: post.event_window.timezone,
              })}{" "}
              –{" "}
              {new Date(post.event_window.ends_at).toLocaleString("en-ZA", {
                timeZone: post.event_window.timezone,
              })}
            </p>
          )}
        </div>
        <aside className="space-y-5">
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="font-semibold">{post.seller.public_name ?? "Member"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {post.seller.identity_verified ? "Identity reviewed" : "Member"}
            </p>
          </div>
          <FoundationContact postId={post.id} channels={allowed} />
          <ReportDialog
            targetId={post.id}
            targetType={post.kind === "event" ? "promotion" : post.kind}
            targetName={post.title}
          />
        </aside>
      </div>
    </main>
  );
}
