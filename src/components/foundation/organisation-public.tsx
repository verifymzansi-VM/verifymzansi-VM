import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import {
  readFoundationOrganisationDirectory,
  readFoundationPublicOrganisation,
} from "@/lib/foundation/organisations";
import { foundationMediaUrl } from "@/lib/foundation/public-cards";
export async function FoundationOrganisations({ home = false }: { home?: boolean }) {
  const entries = (await readFoundationOrganisationDirectory(foundationServerPublicApi())).filter(
    (item) => !home || item.on_home
  );
  if (home && !entries.length) return null;
  return (
    <section className="container-page space-y-6 py-8">
      <h2 className="font-display text-2xl font-bold">Local organisations</h2>
      <p className="text-muted-foreground">
        Explore organisations and programmes supporting local businesses.
      </p>
      {!entries.length && <p>No organisations are currently listed.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((item) => {
          const logo = foundationMediaUrl(item.logo_object_key);
          return (
            <Link
              href={`/organisation/${item.slug}`}
              key={item.slug}
              className="flex items-center gap-4 rounded-2xl border bg-card p-5"
            >
              {logo && (
                <Image
                  src={logo}
                  width={64}
                  height={64}
                  alt=""
                  className="h-16 w-16 object-contain"
                />
              )}
              <div>
                <h3 className="font-semibold">{item.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.service_area ?? item.province?.replaceAll("_", " ")} ·{" "}
                  {item.live_businesses} live businesses
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
export async function FoundationPublicOrganisationPage({ slug }: { slug: string }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) notFound();
  const org = await readFoundationPublicOrganisation(foundationServerPublicApi(), { slug });
  if (!org) notFound();
  const logo = foundationMediaUrl(org.logo_object_key);
  const website = (() => {
    try {
      const url = new URL(org.website ?? "");
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  })();
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="container-page flex-1 space-y-6 py-8">
        <Link className="underline" href="/sponsors">
          All organisations
        </Link>
        <header className="flex items-center gap-5">
          {logo && (
            <Image src={logo} width={96} height={96} alt="" className="h-24 w-24 object-contain" />
          )}
          <h1 className="font-display text-3xl font-bold">{org.name}</h1>
        </header>
        <p className="whitespace-pre-wrap">{org.description}</p>
        {org.programme_description && (
          <p className="whitespace-pre-wrap">{org.programme_description}</p>
        )}
        <p className="text-muted-foreground">
          {org.service_area ?? org.province?.replaceAll("_", " ")} · {org.live_businesses} live
          businesses
        </p>
        <div className="flex flex-wrap gap-5">
          {website && (
            <a className="underline" href={website} target="_blank" rel="noopener noreferrer">
              Website
            </a>
          )}
          {org.public_email && (
            <a className="underline" href={`mailto:${encodeURIComponent(org.public_email)}`}>
              Email organisation
            </a>
          )}
          {org.public_phone && (
            <a className="underline" href={`tel:${org.public_phone}`}>
              Call organisation
            </a>
          )}
        </div>
        {org.programmes.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Programmes</h2>
            {org.programmes.map((item) => (
              <article className="rounded-xl border p-5" key={item.id}>
                <h3 className="font-semibold">{item.name}</h3>
                <p className="mt-2 whitespace-pre-wrap">{item.description}</p>
              </article>
            ))}
          </section>
        )}
        {org.accepting_applications && (
          <Link
            className="inline-block rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground"
            href={`/dashboard/affiliations?org=${encodeURIComponent(org.slug)}`}
          >
            Apply with your business
          </Link>
        )}
        <div>
          <Link className="underline" href="/mzansi-business">
            Browse local businesses
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
