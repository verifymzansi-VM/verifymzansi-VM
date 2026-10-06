import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Globe, Mail, MapPin, Phone, Users } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BrandSurface, brandOutlineButtonClassName } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_STICKER_COLUMNS, toPublicVerification } from "@/lib/business-verification/public";
import {
  BusinessCardGridItem,
  type BusinessCardGridRow,
} from "@/components/listings/business-card-grid-item";
import { SponsorLogo } from "@/components/organisations/sponsor-logo";
import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { getCommercialSettings, organisationsPublicEnabled } from "@/lib/commercial/settings";
import { createClient } from "@/lib/supabase/server";
import { ALL_BUSINESS_CATEGORIES, BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import { getProvinceNames } from "@/lib/constants/sa-provinces";
import {
  getPublicSponsors,
  organisationTypeLabel,
  sponsorArea,
} from "@/lib/organisations/sponsors";
import { cn } from "@/lib/utils";

/** Card fields only: never select("*") into a public page. */
const ORG_CARD_COLUMNS = `id, business_type, business_name, description, cover_photo, cover_video, video_thumbnail, logo_url, gallery_photos, location_province, location_city, category, subcategory, boost_until, featured_until, service_areas, focal_x, focal_y, media_width, media_height, view_count, ${CARD_STICKER_COLUMNS}`;

export const revalidate = 300;

const PAGE_SIZE = 24;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const selectClass =
  "mt-1 block h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm";

type Params = { slug: string };
type Search = {
  q?: string;
  category?: string;
  subcategory?: string;
  province?: string;
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
  sponsorship_wording: string;
  accepting_applications: boolean;
}

interface DirectoryRow {
  business_id: string;
  total_count: number;
}

async function loadOrganisation(slug: string): Promise<PublicOrganisation | null> {
  if (!SLUG.test(slug)) return null;
  const supabase = await createClient();
  if (!(await organisationsPublicEnabled(supabase as never))) return null;
  const { data } = await supabase
    .from("organisations")
    .select(
      "id, slug, name, organisation_type, description, programme_description, service_area, province, website, public_email, public_phone, logo_url, logo_permission_at, programme_status, affiliation_wording, sponsorship_wording, accepting_applications, is_public"
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

async function liveCount(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("organisation_public_stats", { p_org: orgId });
  return Number((data as { affiliatedCount?: number } | null)?.affiliatedCount ?? 0);
}

async function minimumLive(): Promise<number> {
  const supabase = await createClient();
  return (await getCommercialSettings(supabase as never)).sponsors.stripMinLive;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const org = await loadOrganisation((await params).slug);
  if (!org) return { title: "Organisation not found", robots: { index: false } };
  const description =
    org.programme_description?.slice(0, 155) ??
    org.description?.slice(0, 155) ??
    `Local businesses supported by ${org.name} on VerifyMzansi.`;
  // Kept out of search engines until the showcase has real content.
  const [live, minimum] = await Promise.all([liveCount(org.id), minimumLive()]);
  return {
    title: `Businesses supported by ${org.name}`,
    description,
    alternates: { canonical: `/organisation/${org.slug}` },
    openGraph: { title: `Businesses supported by ${org.name}`, description },
    ...(live < minimum ? { robots: { index: false, follow: true } } : {}),
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
  const category = ALL_BUSINESS_CATEGORIES.find((c) => c.value === query.category);
  const filters = {
    q: clean(query.q),
    category: category?.value,
    subcategory: category?.subcategories.some((s) => s.value === query.subcategory)
      ? query.subcategory
      : undefined,
    province: getProvinceNames().includes(query.province ?? "") ? query.province : undefined,
    city: clean(query.city, 60),
    programme:
      query.programme && /^[0-9a-f-]{36}$/i.test(query.programme) ? query.programme : undefined,
    sponsored: query.sponsored === "1" ? true : undefined,
  };
  const page = Math.max(1, Math.min(200, Number.parseInt(query.page ?? "1", 10) || 1));
  const filtered = Object.values(filters).some((value) => value !== undefined);

  const supabase = await createClient();
  const [directory, live, sponsors, programmes] = await Promise.all([
    supabase.rpc("organisation_directory", {
      p_org: org.id,
      p_search: filters.q ?? null,
      p_category: filters.category ?? null,
      p_subcategory: filters.subcategory ?? null,
      p_province: filters.province ?? null,
      p_city: filters.city ?? null,
      p_programme: filters.programme ?? null,
      p_sponsored: filters.sponsored ?? null,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    liveCount(org.id),
    getPublicSponsors(),
    supabase
      .from("organisation_programmes")
      .select("id, name")
      .eq("organisation_id", org.id)
      .eq("active", true),
  ]);
  const rows = (directory.data ?? []) as DirectoryRow[];
  const total = Number(rows[0]?.total_count ?? 0);
  const ids = rows.map((row) => row.business_id);
  const { data: businessRows } = ids.length
    ? await supabase.from("businesses").select(ORG_CARD_COLUMNS).in("id", ids)
    : { data: [] as BusinessCardGridRow[] };
  // Keep the directory order (the RPC sorts and filters).
  const businesses = ids
    .map((id) => (businessRows ?? []).find((row) => row.id === id))
    .filter(Boolean)
    // Expired stickers never show, even before the daily job clears them.
    .map((row) => toPublicVerification(row as BusinessCardGridRow));

  const sponsor = sponsors.find((row) => row.id === org.id);
  const isProgramme = ["founding_trial", "active_paid"].includes(org.programme_status);
  // Below the minimum the page stays out of search engines (generateMetadata);
  // businesses that are live are always shown — only an empty grid is replaced.
  const onboarding = live === 0;
  const placesAvailable = sponsor ? sponsor.places_available : true;
  const logo = org.logo_permission_at ? org.logo_url : null;
  const area = sponsorArea(org);
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
        <BrandSurface as="section" aria-labelledby="organisation-title">
          <div className="container-page grid gap-6 pb-10 pt-6 sm:pt-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:pb-12">
            <div className="min-w-0">
              <Breadcrumbs
                items={[{ label: "Programme partners", href: "/sponsors" }, { label: org.name }]}
                tone="inverse"
              />
              <div className="mt-5 flex items-start gap-4">
                <SponsorLogo
                  src={logo}
                  name={org.name}
                  size={72}
                  className="rounded-2xl shadow-lg ring-white/10"
                />
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-gold-300">
                    {isProgramme ? "Programme partner" : "Business network"} ·{" "}
                    {organisationTypeLabel(org.organisation_type)}
                  </p>
                  <h1
                    id="organisation-title"
                    className="mt-2 font-display text-[1.9rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-white sm:text-[2.6rem]"
                  >
                    {isProgramme ? (
                      <>
                        Businesses supported by{" "}
                        <span className="gold-shine text-brand-gold-300">{org.name}</span>
                      </>
                    ) : (
                      <>
                        <span className="gold-shine text-brand-gold-300">{org.name}</span> business
                        network
                      </>
                    )}
                  </h1>
                </div>
              </div>
              {org.programme_description || org.description ? (
                <p className="mt-4 max-w-2xl text-base leading-7 text-white/75">
                  {org.programme_description ?? org.description}
                </p>
              ) : null}
              <ul className="mt-5 flex flex-wrap gap-2 text-sm text-white/85">
                <li className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5">
                  <Users aria-hidden="true" className="h-4 w-4 text-brand-gold-300" />
                  <strong className="tabular-nums">{live}</strong> live{" "}
                  {live === 1 ? "business" : "businesses"}
                </li>
                {area ? (
                  <li className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5">
                    <MapPin aria-hidden="true" className="h-4 w-4 text-brand-gold-300" />
                    {area}
                  </li>
                ) : null}
              </ul>
              <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm text-white/70">
                {org.website ? (
                  <a
                    className="inline-flex min-h-11 items-center gap-1.5 underline-offset-4 hover:underline"
                    href={org.website}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                  >
                    <Globe aria-hidden="true" className="h-4 w-4" />
                    Website
                  </a>
                ) : null}
                {org.public_email ? (
                  <a
                    className="inline-flex min-h-11 items-center gap-1.5 break-all underline-offset-4 hover:underline"
                    href={`mailto:${org.public_email}`}
                  >
                    <Mail aria-hidden="true" className="h-4 w-4 shrink-0" />
                    {org.public_email}
                  </a>
                ) : null}
                {org.public_phone ? (
                  <a
                    className="inline-flex min-h-11 items-center gap-1.5 underline-offset-4 hover:underline"
                    href={`tel:${org.public_phone}`}
                  >
                    <Phone aria-hidden="true" className="h-4 w-4" />
                    {org.public_phone}
                  </a>
                ) : null}
              </div>
            </div>
            {org.accepting_applications ? (
              <div className="flex flex-col items-start gap-2 lg:items-end">
                {placesAvailable ? (
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className={cn("h-12 rounded-full px-6", brandOutlineButtonClassName)}
                  >
                    <Link href={`/dashboard/affiliations?org=${org.slug}`}>
                      Apply to join this programme
                    </Link>
                  </Button>
                ) : (
                  <Badge className="bg-white/10 px-3 py-1.5 text-sm text-white">
                    Programme full
                  </Badge>
                )}
                <p className="text-xs text-white/60">For business owners on VerifyMzansi.</p>
              </div>
            ) : null}
          </div>
        </BrandSurface>

        <div className="container-page space-y-6 py-6 sm:py-8">
          <p className="rounded-xl border border-border/70 bg-muted/50 p-4 text-sm leading-6 text-muted-foreground">
            <strong className="text-foreground">
              &ldquo;{org.sponsorship_wording} {org.name}&rdquo;
            </strong>{" "}
            means this business is part of {org.name}&rsquo;s programme. It is not a verification,
            safety or quality endorsement. VerifyMzansi reviews identities separately.
          </p>

          {onboarding && !filtered ? (
            <section className="rounded-2xl border border-dashed p-6 text-center sm:p-10">
              <h2 className="font-display text-xl font-bold">Businesses are being onboarded</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {org.name} is welcoming its first businesses. Their profiles appear here once they
                pass VerifyMzansi&rsquo;s identity review and moderation.
              </p>
              <Button asChild variant="outline" className="mt-4 h-11 rounded-full">
                <Link href="/mzansi-business">Browse Mzansi Business</Link>
              </Button>
            </section>
          ) : (
            <>
              <form
                method="get"
                className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
                aria-label="Filter supported businesses"
              >
                <label className="text-sm lg:col-span-2">
                  Find a business
                  <input name="q" type="search" defaultValue={filters.q} className={selectClass} />
                </label>
                <label className="text-sm">
                  Category
                  <select
                    name="category"
                    defaultValue={filters.category ?? ""}
                    className={selectClass}
                  >
                    <option value="">All categories</option>
                    {BUSINESS_CATEGORIES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                {category ? (
                  <label className="text-sm">
                    Specific activity
                    <select
                      name="subcategory"
                      defaultValue={filters.subcategory ?? ""}
                      className={selectClass}
                    >
                      <option value="">All activities</option>
                      {category.subcategories.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="text-sm">
                  Province
                  <select
                    name="province"
                    defaultValue={filters.province ?? ""}
                    className={selectClass}
                  >
                    <option value="">All provinces</option>
                    {getProvinceNames().map((province) => (
                      <option key={province} value={province}>
                        {province}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  City or town
                  <input name="city" defaultValue={filters.city} className={selectClass} />
                </label>
                {(programmes.data ?? []).length > 1 ? (
                  <label className="text-sm">
                    Programme
                    <select
                      name="programme"
                      defaultValue={filters.programme ?? ""}
                      className={selectClass}
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
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="sponsored"
                    value="1"
                    defaultChecked={filters.sponsored === true}
                    className="h-4 w-4"
                  />
                  Sponsored only
                </label>
                <div className="flex gap-2">
                  <Button type="submit" className="h-11 flex-1">
                    Filter
                  </Button>
                  {filtered ? (
                    <Button asChild variant="ghost" className="h-11">
                      <Link href={`/organisation/${org.slug}`}>Clear</Link>
                    </Button>
                  ) : null}
                </div>
              </form>

              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-lg font-semibold">
                  Supported businesses <span className="text-muted-foreground">({total})</span>
                </h2>
                <Link
                  href={`/mzansi-business?org=${org.slug}`}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-green-700 underline-offset-4 hover:underline dark:text-brand-green-300"
                >
                  Browse with all Mzansi Business filters
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </div>

              {businesses.length === 0 ? (
                <p className="rounded-xl border p-6 text-sm text-muted-foreground">
                  No supported businesses match these filters.{" "}
                  <Link className="underline" href={`/organisation/${org.slug}`}>
                    Clear filters
                  </Link>
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {businesses.map((business, index) => (
                    <BusinessCardGridItem key={business.id} business={business} index={index} />
                  ))}
                </div>
              )}
              <AnalyticsImpressions
                items={ids.map((id) => ({ table: "businesses", id }))}
                type="organisation_directory_appearance"
                surface={`org:${org.slug}`.slice(0, 40)}
              />

              {total > PAGE_SIZE ? (
                <nav aria-label="Directory pages" className="flex items-center justify-between">
                  {page > 1 ? (
                    <Link
                      className="inline-flex min-h-11 items-center underline"
                      href={pageHref(page - 1)}
                    >
                      Previous
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {Math.ceil(total / PAGE_SIZE)}
                  </span>
                  {page * PAGE_SIZE < total ? (
                    <Link
                      className="inline-flex min-h-11 items-center underline"
                      href={pageHref(page + 1)}
                    >
                      Next
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
            </>
          )}
          {/* Sponsor-page visits feed the programme's activity report. */}
          <AnalyticsImpressions
            items={[{ table: "organisations", id: org.id }]}
            type="detail_view"
            surface="sponsor_page"
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
