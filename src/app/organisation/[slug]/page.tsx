import type { Metadata } from "next";
import { organisationsPublicEnabled } from "@/lib/commercial/settings";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Building2, Globe, Mail, MapPin, Phone } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_CATEGORY_LABELS, type BusinessCategory } from "@/types/enums";
import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";

export const revalidate = 300;

const PAGE_SIZE = 24;
const PROGRAMME_STATUS_LABELS: Record<string, string> = {
  founding_trial: "Founding programme",
  active_paid: "Active programme",
  affiliation_only: "Affiliation network",
};
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Params = { slug: string };
type Search = {
  type?: string;
  q?: string;
  category?: string;
  city?: string;
  programme?: string;
  sponsored?: string;
  page?: string;
};

interface PublicOrganisation {
  id: string;
  slug: string;
  name: string;
  organisation_type: string;
  description: string | null;
  programme_description: string | null;
  service_area: string | null;
  province: string | null;
  website: string | null;
  public_email: string | null;
  public_phone: string | null;
  logo_url: string | null;
  logo_permission_at: string | null;
  programme_status: string;
  affiliation_wording: string;
}

interface DirectoryRow {
  business_id: string;
  business_name: string;
  slug: string | null;
  category: string | null;
  subcategory: string | null;
  city: string | null;
  province: string | null;
  logo_url: string | null;
  cover_image: string | null;
  programme_name: string | null;
  confirmed_at: string;
  sponsored: boolean;
  affiliation_label: string | null;
  total_count: number;
}

async function loadOrganisation(slug: string): Promise<PublicOrganisation | null> {
  if (!SLUG.test(slug)) return null;
  const supabase = await createClient();
  if (!(await organisationsPublicEnabled(supabase as never))) return null;
  const { data } = await supabase
    .from("organisations")
    .select(
      "id, slug, name, organisation_type, description, programme_description, service_area, province, website, public_email, public_phone, logo_url, logo_permission_at, programme_status, affiliation_wording, is_public"
    )
    .eq("slug", slug)
    .maybeSingle();
  // RLS only returns listed organisations to the public; re-check explicitly.
  if (
    !data ||
    !data.is_public ||
    !["founding_trial", "active_paid", "affiliation_only"].includes(data.programme_status)
  ) {
    return null;
  }
  return data as PublicOrganisation;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const org = await loadOrganisation((await params).slug);
  if (!org) return { title: "Organisation not found", robots: { index: false } };
  const description =
    org.description?.slice(0, 155) ??
    `Businesses participating in ${org.name} programmes, verified on VerifyMzansi.`;
  return {
    title: `${org.name} Business Network`,
    description,
    alternates: { canonical: `/organisation/${org.slug}` },
    openGraph: { title: `${org.name} Business Network`, description },
  };
}

function clean(value: string | undefined, max = 80) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export default async function OrganisationPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { slug } = await params;
  const org = await loadOrganisation(slug);
  if (!org) notFound();

  const query = await searchParams;
  const filters = {
    q: clean(query.q),
    category: clean(query.category, 40),
    city: clean(query.city, 60),
    programme:
      query.programme && /^[0-9a-f-]{36}$/i.test(query.programme) ? query.programme : undefined,
    sponsored: query.sponsored === "1" ? true : undefined,
    type:
      query.type && ["participant", "member", "affiliate"].includes(query.type)
        ? query.type
        : undefined,
  };
  const page = Math.max(1, Math.min(200, Number.parseInt(query.page ?? "1", 10) || 1));

  const supabase = await createClient();
  const [directory, stats, programmes] = await Promise.all([
    supabase.rpc("organisation_directory", {
      p_org: org.id,
      p_search: filters.q ?? null,
      p_category: filters.category ?? null,
      p_city: filters.city ?? null,
      p_programme: filters.programme ?? null,
      p_sponsored: filters.sponsored ?? null,
      p_type: filters.type ?? null,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    supabase.rpc("organisation_public_stats", { p_org: org.id }),
    supabase
      .from("organisation_programmes")
      .select("id, name")
      .eq("organisation_id", org.id)
      .eq("active", true),
  ]);
  const rows = (directory.data ?? []) as DirectoryRow[];
  const total = rows[0]?.total_count ?? 0;
  const counts = (stats.data ?? {}) as { affiliatedCount?: number; sponsoredCount?: number };
  const logo = org.logo_permission_at ? org.logo_url : null;
  const pageHref = (next: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined) params.set(key, value === true ? "1" : String(value));
    params.set("page", String(next));
    return `/organisation/${org.slug}?${params.toString()}`;
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: org.name,
    url: `${process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com"}/organisation/${org.slug}`,
    ...(org.website ? { sameAs: [org.website] } : {}),
    ...(org.service_area ? { areaServed: org.service_area } : {}),
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
      />
      <main id="main-content" className="flex-1 scroll-mt-24">
        <section className="border-b border-warm-200/70 bg-hero-mesh dark:border-warm-800/60">
          <div className="container-page space-y-4 py-6 sm:py-8">
            <PageHeader
              title={`${org.name} Business Network`}
              description={org.programme_description ?? org.description ?? undefined}
              breadcrumbs={[
                { label: "Mzansi Business", href: "/mzansi-business" },
                { label: org.name },
              ]}
            />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {logo ? (
                <Image
                  src={logo}
                  alt={`${org.name} logo`}
                  width={72}
                  height={72}
                  className="h-16 w-16 rounded-xl border bg-white object-contain p-1"
                  unoptimized
                />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-xl border bg-card">
                  <Building2 aria-hidden="true" className="h-7 w-7 text-muted-foreground" />
                </span>
              )}
              <div className="space-y-1 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{org.organisation_type.replace(/_/g, " ")}</Badge>
                  <Badge variant="secondary">
                    {PROGRAMME_STATUS_LABELS[org.programme_status] ?? "Programme"}
                  </Badge>
                  <span>
                    <strong>{counts.affiliatedCount ?? total}</strong> participating businesses
                  </span>
                  {counts.sponsoredCount ? (
                    <span>· {counts.sponsoredCount} with sponsored visibility</span>
                  ) : null}
                </p>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  {org.service_area || org.province ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                      {[org.service_area, org.province].filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                  {org.website ? (
                    <a
                      className="inline-flex items-center gap-1 underline"
                      href={org.website}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                    >
                      <Globe aria-hidden="true" className="h-3.5 w-3.5" />
                      Website
                    </a>
                  ) : null}
                  {org.public_email ? (
                    <a
                      className="inline-flex items-center gap-1 underline"
                      href={`mailto:${org.public_email}`}
                    >
                      <Mail aria-hidden="true" className="h-3.5 w-3.5" />
                      {org.public_email}
                    </a>
                  ) : null}
                  {org.public_phone ? (
                    <a
                      className="inline-flex items-center gap-1 underline"
                      href={`tel:${org.public_phone}`}
                    >
                      <Phone aria-hidden="true" className="h-3.5 w-3.5" />
                      {org.public_phone}
                    </a>
                  ) : null}
                </p>
              </div>
            </div>
            <p className="max-w-3xl text-xs text-muted-foreground">
              “{org.affiliation_wording}” means {org.name} has confirmed the business participates
              in its programme. It is not a guarantee by the organisation. Identity checks are done
              separately by VerifyMzansi.
            </p>
          </div>
        </section>

        <div className="container-page space-y-6 py-6 sm:py-8">
          <form
            method="get"
            className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-5 sm:items-end"
            aria-label="Filter participating businesses"
          >
            <label className="text-sm sm:col-span-2">
              Business name
              <input
                name="q"
                defaultValue={filters.q}
                className="mt-1 block h-11 w-full rounded-md border bg-background px-3"
              />
            </label>
            <label className="text-sm">
              Category
              <select
                name="category"
                defaultValue={filters.category ?? ""}
                className="mt-1 block h-11 w-full rounded-md border bg-background px-2"
              >
                <option value="">All categories</option>
                {Object.entries(BUSINESS_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Town or city
              <input
                name="city"
                defaultValue={filters.city}
                className="mt-1 block h-11 w-full rounded-md border bg-background px-3"
              />
            </label>
            {(programmes.data ?? []).length > 1 ? (
              <label className="text-sm">
                Programme
                <select
                  name="programme"
                  defaultValue={filters.programme ?? ""}
                  className="mt-1 block h-11 w-full rounded-md border bg-background px-2"
                >
                  <option value="">All programmes</option>
                  {(programmes.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="text-sm">
              Relationship
              <select
                name="type"
                defaultValue={filters.type ?? ""}
                className="mt-1 block h-11 w-full rounded-md border bg-background px-2"
              >
                <option value="">All relationships</option>
                <option value="participant">{org.affiliation_wording}</option>
                <option value="member">Member</option>
                <option value="affiliate">Affiliated with</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="sponsored"
                value="1"
                defaultChecked={filters.sponsored === true}
                className="h-4 w-4"
              />
              Sponsored only
            </label>
            <Button type="submit" className="h-11">
              Filter
            </Button>
          </form>

          <h2 className="font-display text-lg font-semibold">Participating businesses ({total})</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No participating businesses match these filters yet.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <li key={row.business_id}>
                  <Link
                    href={`/mzansi-business/${row.business_id}`}
                    className="surface-card flex h-full gap-3 p-4 transition-shadow hover:elev-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.logo_url ? (
                      <Image
                        src={row.logo_url}
                        alt=""
                        width={56}
                        height={56}
                        className="h-14 w-14 shrink-0 rounded-lg border bg-white object-contain p-0.5"
                        unoptimized
                      />
                    ) : (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border bg-muted">
                        <Building2 aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
                      </span>
                    )}
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate font-semibold">{row.business_name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {BUSINESS_CATEGORY_LABELS[row.category as BusinessCategory] ??
                          row.category ??
                          "Business"}
                        {row.city ? ` · ${row.city}` : ""}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {row.affiliation_label ?? org.affiliation_wording}
                        {row.programme_name ? ` — ${row.programme_name}` : ""}
                      </span>
                      {row.sponsored ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Sponsored visibility
                        </Badge>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <AnalyticsImpressions
            items={rows.map((row) => ({ table: "businesses", id: row.business_id }))}
            type="organisation_directory_appearance"
            surface={`org:${org.slug}`.slice(0, 40)}
          />

          {total > PAGE_SIZE ? (
            <nav aria-label="Directory pages" className="flex items-center justify-between">
              {page > 1 ? (
                <Link className="underline" href={pageHref(page - 1)}>
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-muted-foreground">
                Page {page} of {Math.ceil(total / PAGE_SIZE)}
              </span>
              {page * PAGE_SIZE < total ? (
                <Link className="underline" href={pageHref(page + 1)}>
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Own a business in this programme?{" "}
            <Link className="underline" href="/dashboard/affiliations">
              Request affiliation from your dashboard
            </Link>
            .
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
