"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Check,
  Globe,
  Mail,
  MapPin,
  MessageSquare,
  Tag,
  Ticket,
  Timer,
  X,
} from "lucide-react";
import { FacebookIcon, InstagramIcon, TikTokIcon, XIcon } from "@/components/icons/social-icons";
import { BrandShield } from "@/components/shared/brand-shield";
import { ContentContactActions } from "@/components/listings/content-contact-actions";
import {
  businessContactConfig,
  listingContactConfig,
  promotionContactConfig,
} from "@/components/listings/contact-action-configs";
import { TrustBadge } from "@/components/trust/trust-badge";
import { getOpenStatus, type OpenStatus } from "@/lib/business/open-status";
import type { FeedLink, FeedSection, FeedSlide } from "@/lib/feed/types";
import { getEventState, type EventState } from "@/lib/presentation/event-facts";
import { cn } from "@/lib/utils";

/* ─────────────── Live chips: open now / event state ─────────────── */

/** Opening status recomputed each minute while the post is on screen. */
function useOpenStatus(hours: FeedSlide["headline"]["hours"], active: boolean): OpenStatus | null {
  // The viewer only renders in the browser, so the clock can be read up front.
  const [status, setStatus] = useState<OpenStatus | null>(() =>
    hours ? getOpenStatus(hours) : null
  );
  useEffect(() => {
    if (!hours || !active) return;
    const timer = window.setInterval(() => setStatus(getOpenStatus(hours)), 60_000);
    return () => window.clearInterval(timer);
  }, [hours, active]);
  return hours ? status : null;
}

const EVENT_STATE_CHIP: Record<EventState, { label: string; tone: string }> = {
  upcoming: { label: "Upcoming", tone: "bg-white/10 text-white" },
  ongoing: { label: "Happening now", tone: "bg-brand-green-300/15 text-brand-green-300" },
  ended: { label: "Event ended", tone: "bg-white/10 text-white/60" },
};

function useEventClock(event: FeedSlide["headline"]["event"], active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!event || !active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [event, active]);
  if (!event) return null;
  const state = getEventState(event.start, event.end, now);
  const target = state === "upcoming" ? event.start : state === "ongoing" ? event.end : null;
  const remaining = target ? new Date(target).getTime() - now : 0;
  return { state, target, remaining };
}

function Countdown({
  remaining,
  label,
  calendarUrl,
}: {
  remaining: number;
  label: string;
  calendarUrl: string | null;
}) {
  if (remaining <= 0) return null;
  const units = [
    { value: Math.floor(remaining / 86_400_000), label: "days" },
    { value: Math.floor((remaining % 86_400_000) / 3_600_000), label: "hrs" },
    { value: Math.floor((remaining % 3_600_000) / 60_000), label: "min" },
    { value: Math.floor((remaining % 60_000) / 1000), label: "sec" },
  ];
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-brand-green-950/60 px-4 py-3">
      <Timer className="h-4 w-4 shrink-0 text-brand-gold-300" aria-hidden="true" />
      <p className="sr-only">
        {label} {units[0].value} days {units[1].value} hours {units[2].value} minutes
      </p>
      <span className="text-sm text-white/70" aria-hidden="true">
        {label}
      </span>
      <div className="ml-auto flex gap-2.5" aria-hidden="true">
        {units.map((unit) => (
          <span key={unit.label} className="text-center">
            <span className="block font-display text-lg font-bold leading-none tabular-nums text-white">
              {String(unit.value).padStart(2, "0")}
            </span>
            <span className="text-[10px] text-white/50">{unit.label}</span>
          </span>
        ))}
      </div>
      {calendarUrl ? (
        <a
          href={calendarUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Add to calendar"
          title="Add to calendar"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
        >
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── Headline ─────────────────────────── */

const META_ICONS = {
  date: CalendarDays,
  location: MapPin,
  views: Tag,
  type: Tag,
} as const;

export function SlideHeadline({
  slide,
  active,
  titleAs = "h2",
}: {
  slide: FeedSlide;
  active: boolean;
  titleAs?: "h1" | "h2";
}) {
  const TitleTag = titleAs;
  const openStatus = useOpenStatus(slide.headline.hours, active);
  const eventClock = useEventClock(slide.headline.event, active);
  const eventChip = eventClock ? EVENT_STATE_CHIP[eventClock.state] : null;

  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {eventChip ? (
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", eventChip.tone)}>
            {eventChip.label}
          </span>
        ) : null}
        {openStatus && openStatus.state !== "unknown" ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
              openStatus.state === "open"
                ? "bg-brand-green-300/15 text-brand-green-300"
                : "bg-white/10 text-white/75"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                openStatus.state === "open" ? "bg-brand-green-300" : "bg-white/50"
              )}
            />
            {openStatus.label}
          </span>
        ) : null}
        {slide.headline.chips.map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs text-white/80"
          >
            {chip}
          </span>
        ))}
      </div>

      <TitleTag className="break-words font-display text-[1.65rem] font-bold leading-[1.12] tracking-[-0.02em] text-white xl:text-[1.85rem]">
        {slide.title}
      </TitleTag>

      {slide.headline.figure ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-display text-[2.1rem] font-bold leading-none tracking-[-0.02em] text-brand-gold-300 tabular-nums">
            {slide.headline.figure.value}
          </p>
          {slide.headline.figure.note ? (
            <span className="rounded-full border border-brand-gold-300/40 px-2.5 py-0.5 text-xs font-medium text-brand-gold-300">
              {slide.headline.figure.note}
            </span>
          ) : null}
        </div>
      ) : null}

      {slide.headline.meta.length > 0 ? (
        <ul className="space-y-1.5 text-sm text-white/70">
          {slide.headline.meta.map((item) => {
            const Icon = META_ICONS[item.icon];
            return (
              <li key={`${item.icon}-${item.text}`} className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-white/45" aria-hidden="true" />
                <span className="min-w-0 break-words">{item.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {eventClock && eventClock.target ? (
        <Countdown
          remaining={eventClock.remaining}
          label={eventClock.state === "upcoming" ? "Starts in" : "Ends in"}
          calendarUrl={slide.headline.event?.calendarUrl ?? null}
        />
      ) : null}
    </header>
  );
}

/* ─────────────────────────── Owner + contact ─────────────────────────── */

function OwnerAvatar({ slide, size = 44 }: { slide: FeedSlide; size?: number }) {
  return slide.owner.logoUrl ? (
    <span
      className="relative block shrink-0 overflow-hidden rounded-full bg-white"
      style={{ width: size, height: size }}
    >
      <Image
        src={slide.owner.logoUrl}
        alt=""
        fill
        sizes={`${size}px`}
        className="object-contain p-0.5"
      />
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-brand-green-700 font-display font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {slide.owner.initials}
    </span>
  );
}

function contactConfigFor(slide: FeedSlide) {
  if (slide.table === "listings") return listingContactConfig(slide.id, slide.title);
  if (slide.table === "promotions") return promotionContactConfig(slide.id);
  return businessContactConfig(slide.id, slide.title, slide.href);
}

function ContactBlock({ slide }: { slide: FeedSlide }) {
  const name = slide.owner.href ? (
    <Link
      href={slide.owner.href}
      className="break-words font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
    >
      {slide.owner.name}
    </Link>
  ) : (
    <p className="break-words font-semibold text-white">{slide.owner.name}</p>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <OwnerAvatar slide={slide} />
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-white/55">{slide.owner.label}</p>
          {name}
          {slide.owner.trustLevel ? <TrustBadge level={slide.owner.trustLevel} size="sm" /> : null}
        </div>
      </div>
      {slide.contact.cta ? (
        <a
          href={slide.contact.cta.href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-brand-gold-300 px-5 text-sm font-semibold text-brand-gold-950 transition-colors hover:bg-brand-gold-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <CalendarCheck className="h-4 w-4" aria-hidden="true" />
          {slide.contact.cta.label}
        </a>
      ) : null}
      <div className="space-y-1 rounded-2xl bg-card p-3 text-card-foreground">
        <ContentContactActions
          phone={slide.contact.phone}
          whatsapp={slide.contact.whatsapp}
          showPhoneButton={slide.contact.showPhoneButton}
          showMessageButton={slide.contact.showMessageButton}
          messageIcon={MessageSquare}
          config={contactConfigFor(slide)}
          showShare={false}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────── Sections ─────────────────────────── */

const LINK_ICONS: Record<FeedLink["icon"], typeof Globe> = {
  web: Globe,
  map: MapPin,
  social: Globe,
  email: Mail,
  tickets: Ticket,
  calendar: CalendarPlus,
  booking: CalendarCheck,
};

const SOCIAL_ICONS: Record<string, (props: { className?: string }) => ReactNode> = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
  tiktok: TikTokIcon,
  twitter: XIcon,
  x: XIcon,
};

/** "Available" / "Yes" read faster as a tick; "Not available" / "No" as a cross. */
function BooleanValue({ value }: { value: string }) {
  const yes = value === "Yes" || value === "Available";
  const no = value === "No" || value === "Not available";
  if (!yes && !no) return <>{value}</>;
  const Icon = yes ? Check : X;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon
        className={cn("h-4 w-4", yes ? "text-brand-green-300" : "text-white/45")}
        aria-hidden="true"
      />
      <span className={yes ? undefined : "text-white/60"}>{yes ? "Yes" : "No"}</span>
    </span>
  );
}

function SectionShell({ title, children }: { title?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className="space-y-3 border-t border-white/10 py-5 first:border-t-0 first:pt-0 last:pb-0"
    >
      {title ? (
        <h3 id={headingId} className="text-sm font-semibold text-white">
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

function ClampedText({ body, clamp }: { body: string; clamp?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = Boolean(clamp) && body.length > 320;
  return (
    <div className="space-y-2">
      <p
        className={cn(
          "whitespace-pre-wrap break-words text-sm leading-6 text-white/75",
          long && !expanded && "line-clamp-6"
        )}
      >
        {body}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="text-sm font-semibold text-brand-gold-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

function isExternal(href: string) {
  return /^https?:\/\//i.test(href);
}

function todayHoursKey(): keyof NonNullable<FeedSlide["headline"]["hours"]> {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
  }).format(new Date());
  return day === "Sun" ? "Sun" : day === "Sat" ? "Sat" : "Mon_Fri";
}

function HoursTable({ hours }: { hours: NonNullable<FeedSlide["headline"]["hours"]> }) {
  // Whether it is open now is in the headline chip; here only today's row is marked.
  const [today] = useState(todayHoursKey);
  const rows = [
    { key: "Mon_Fri", label: "Monday to Friday" },
    { key: "Sat", label: "Saturday" },
    { key: "Sun", label: "Sunday and holidays" },
  ] as const;
  return (
    <dl className="divide-y divide-white/10 text-sm">
      {rows
        .filter((row) => hours[row.key])
        .map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between gap-4 py-2"
            aria-current={row.key === today ? "date" : undefined}
          >
            <dt
              className={cn(
                "flex items-center gap-2",
                row.key === today ? "font-semibold text-white" : "text-white/60"
              )}
            >
              {row.key === today ? (
                <span className="h-1.5 w-1.5 rounded-full bg-brand-gold-300" aria-hidden="true" />
              ) : null}
              {row.label}
              {row.key === today ? <span className="sr-only">(today)</span> : null}
            </dt>
            <dd className="text-right font-medium text-white">{hours[row.key]}</dd>
          </div>
        ))}
    </dl>
  );
}

function renderSection(section: FeedSection, slide: FeedSlide): ReactNode {
  switch (section.type) {
    case "contact":
      return (
        <SectionShell key={section.id}>
          <ContactBlock slide={slide} />
        </SectionShell>
      );
    case "facts":
      return (
        <SectionShell key={section.id} title={section.title}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {section.facts.map((fact) => (
              <div
                key={`${fact.label}-${fact.value}`}
                className={cn("min-w-0", fact.wide && "col-span-2")}
              >
                <dt className="text-xs text-white/55">{fact.label}</dt>
                <dd className="mt-0.5 break-words text-sm font-medium text-white">
                  <BooleanValue value={fact.value} />
                </dd>
              </div>
            ))}
          </dl>
        </SectionShell>
      );
    case "rows":
      return (
        <SectionShell key={section.id} title={section.title}>
          <dl className="divide-y divide-white/10 text-sm">
            {section.rows.map((row) => (
              <div
                key={`${row.label}-${row.value}`}
                className="flex items-start justify-between gap-4 py-2"
              >
                <dt className="shrink-0 text-white/60">{row.label}</dt>
                <dd className="min-w-0 break-words text-right font-medium text-white">
                  <BooleanValue value={row.value} />
                </dd>
              </div>
            ))}
          </dl>
        </SectionShell>
      );
    case "text":
      return (
        <SectionShell key={section.id} title={section.title}>
          <ClampedText body={section.body} clamp={section.clamp} />
        </SectionShell>
      );
    case "chips":
      return (
        <SectionShell key={section.id} title={section.title}>
          <ul className="flex flex-wrap gap-1.5">
            {section.items.map((item, index) => (
              <li
                key={`${item}-${index}`}
                className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/85"
              >
                {item}
              </li>
            ))}
          </ul>
        </SectionShell>
      );
    case "hours":
      return (
        <SectionShell key={section.id} title={section.title}>
          <HoursTable hours={section.hours} />
        </SectionShell>
      );
    case "links": {
      const socials = section.links.filter((link) => link.icon === "social");
      const others = section.links.filter((link) => link.icon !== "social");
      return (
        <SectionShell key={section.id} title={section.title}>
          {others.length > 0 ? (
            <ul className="-mx-2 space-y-0.5">
              {others.map((link) => {
                const Icon = LINK_ICONS[link.icon];
                const external = isExternal(link.href);
                return (
                  <li key={`${link.icon}-${link.href}`}>
                    <a
                      href={link.href}
                      target={external ? "_blank" : undefined}
                      rel={external ? "noopener noreferrer nofollow ugc" : undefined}
                      className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-sm text-white/85 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
                      <span className="min-w-0 break-all">{link.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {socials.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {socials.map((link) => {
                const Icon = SOCIAL_ICONS[link.platform ?? ""] ?? Globe;
                return (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer nofollow ugc"
                      aria-label={link.label}
                      title={link.label}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
                    >
                      <Icon className="h-4 w-4" />
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </SectionShell>
      );
    }
    case "tickets":
      return (
        <SectionShell key={section.id} title={section.title}>
          {section.tiers.length > 0 ? (
            <dl className="divide-y divide-white/10 text-sm">
              {section.tiers.map((tier, index) => (
                <div
                  key={`${tier.name}-${index}`}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <dt className="text-white/80">{tier.name}</dt>
                  <dd className="font-display font-bold tabular-nums text-brand-gold-300">
                    {tier.price}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {section.buyUrl ? (
            <a
              href={section.buyUrl}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="flex h-11 items-center justify-center gap-2 rounded-full bg-brand-gold-300 px-5 text-sm font-semibold text-brand-gold-950 transition-colors hover:bg-brand-gold-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Ticket className="h-4 w-4" aria-hidden="true" />
              Buy tickets
            </a>
          ) : null}
        </SectionShell>
      );
    case "photos":
      return (
        <SectionShell key={section.id} title={section.title}>
          <ul className="grid grid-cols-3 gap-2">
            {section.photos.map((photo) => (
              <li
                key={photo.url}
                className="relative aspect-[4/3] overflow-hidden rounded-xl bg-white/5"
              >
                <Image
                  src={photo.url}
                  alt={photo.alt}
                  fill
                  sizes="120px"
                  className="object-contain"
                />
              </li>
            ))}
          </ul>
        </SectionShell>
      );
    case "posts":
      return (
        <SectionShell key={section.id} title={section.title}>
          <ul className="space-y-1">
            {section.posts.map((post) => (
              <li key={post.key}>
                <Link
                  href={post.href}
                  className="-mx-2 flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
                >
                  <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/10">
                    {post.image ? (
                      <Image src={post.image} alt="" fill sizes="44px" className="object-contain" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">
                      {post.title}
                    </span>
                    {post.meta ? (
                      <span className="block text-xs text-white/55">{post.meta}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionShell>
      );
    case "safety":
      return (
        <SectionShell key={section.id} title="Stay safe when you meet">
          <div className="flex gap-3">
            <BrandShield
              className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold-300"
              aria-hidden="true"
            />
            <p className="text-sm leading-6 text-white/70">
              Meet in a public place, check the item before paying, and never share OTPs or upfront
              deposits with strangers.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pl-8 text-sm">
            <Link
              href="/safety/meeting-checklist"
              prefetch={false}
              className="font-semibold text-brand-gold-300 underline-offset-4 hover:underline"
            >
              Meeting checklist
            </Link>
            <Link
              href="/safety/scam-alerts"
              prefetch={false}
              className="font-semibold text-brand-gold-300 underline-offset-4 hover:underline"
            >
              Scam alerts
            </Link>
          </div>
        </SectionShell>
      );
  }
}

export function SlideSections({ sections, slide }: { sections: FeedSection[]; slide: FeedSlide }) {
  return <div>{sections.map((section) => renderSection(section, slide))}</div>;
}
