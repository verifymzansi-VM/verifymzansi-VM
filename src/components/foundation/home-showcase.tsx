import Link from "next/link";
import Image from "next/image";
import { HomeShowcaseShell } from "@/components/home/home-showcase-shell";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import { searchFoundationCards, foundationMediaUrl } from "@/lib/foundation/public-cards";
import { readFoundationProgrammeShowcases } from "@/lib/foundation/organisation-sponsorships";

export async function FoundationHomeShowcase({
  area,
}: {
  area: "market" | "business" | "tourism_events";
}) {
  const page = await searchFoundationCards(foundationServerPublicApi(), { area, limit: 6 });
  const section =
    area === "market"
      ? { title: "Mzansi Market", href: "/mzansi-market", tone: "green" as const }
      : area === "business"
        ? { title: "Mzansi Business", href: "/mzansi-business", tone: "blue" as const }
        : { title: "Tourism & Events", href: "/tourism-events", tone: "teal" as const };
  return (
    <HomeShowcaseShell {...section}>
      {page.items.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {page.items.map((post) => {
            const image = foundationMediaUrl(post.preview.image_key);
            return (
              <Link
                key={post.id}
                href={`${post.kind === "listing" ? "/listing" : section.href}/${post.id}`}
                className="overflow-hidden rounded-2xl border bg-card"
              >
                {image && (
                  <Image
                    src={image}
                    alt={post.title}
                    width={640}
                    height={480}
                    className="aspect-[4/3] w-full bg-muted object-contain"
                  />
                )}
                <div className="space-y-1 p-4">
                  <h3 className="font-semibold">{post.title}</h3>
                  <p className="text-sm text-muted-foreground">{post.locality}</p>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border bg-card p-6">
          <p className="font-semibold">Discover local posts in {section.title}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Newly approved posts will appear here.
          </p>
          <Link className="mt-4 inline-block text-primary underline" href={section.href}>
            Explore this section
          </Link>
        </div>
      )}
    </HomeShowcaseShell>
  );
}
export async function FoundationProgrammeShowcase({
  placement,
}: {
  placement: "home" | "business" | "tourism" | "market";
}) {
  const groups = await readFoundationProgrammeShowcases(foundationServerPublicApi(), { placement });
  if (!groups.length) return null;
  return (
    <div className="container-page space-y-6 py-7">
      {groups.map((group) => (
        <section key={group.id} className="space-y-4">
          <div>
            <h2 className="font-display text-xl font-semibold">{group.title}</h2>
            <Link
              className="text-sm text-primary underline"
              href={`/organisation/${group.organisation_slug}`}
            >
              {group.organisation_name}
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.cards.map((card) => (
              <Link
                key={card.post_id}
                className="overflow-hidden rounded-2xl border bg-card"
                href={`/mzansi-business/${card.post_id}`}
              >
                <Image
                  src={foundationMediaUrl(card.cover_object_key)!}
                  alt={card.title ?? "Business"}
                  width={640}
                  height={480}
                  className="aspect-[4/3] w-full bg-muted object-contain"
                />
                <h3 className="p-4 font-semibold">{card.title ?? "Business profile"}</h3>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
