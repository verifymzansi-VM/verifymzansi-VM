"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Building2,
  CalendarCheck,
  Check,
  ChevronRight,
  Eye,
  Globe,
  Loader2,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Share2,
  ShoppingBag,
  Ticket,
  TreePalm,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/social-icons";
import { useSharePost } from "@/components/immersive/use-share-post";
import { ContentEnquiryAction } from "@/components/listings/content-enquiry-action";
import { ContentLikeButton } from "@/components/listings/content-like-button";
import { feedContactConfig } from "@/components/listings/contact-action-configs";
import { ReportDialog } from "@/components/shared/report-dialog";
import { TrustBadge } from "@/components/trust/trust-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TourismKind } from "@/lib/feed/browse";
import type { FeedSlide, FeedVertical } from "@/lib/feed/types";
import { cn } from "@/lib/utils";
import { contactPhone, whatsappLink } from "@/lib/utils/contact-links";
import { formatCompactCount } from "@/lib/utils/format";
import { getOpenStatus } from "@/lib/business/open-status";

/** Dark circle with a light ring: readable over any photo or video. 40px inside a 44px target. */
export const VM_CIRCLE =
  "flex h-10 w-10 items-center justify-center rounded-full bg-brand-green-950/75 text-white ring-1 ring-white/20 transition-colors";
/** The symbol inside a circle. */
export const VM_GLYPH = "h-[18px] w-[18px]";
const RAIL_TEXT = "vm-rail-text text-[11px] font-semibold leading-none text-white vm-shadow";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300";

/** Phone and tablet dialogs dock to the bottom edge, like a sheet. */
const VM_DIALOG_SHEET =
  "max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[90dvh] max-sm:w-full max-sm:max-w-none max-sm:translate-y-0 max-sm:overflow-y-auto max-sm:rounded-b-none max-sm:rounded-t-3xl max-sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-sm:data-[state=closed]:slide-out-to-top-[100%] max-sm:data-[state=open]:slide-in-from-top-[100%]";

/* ─────────────────────────── Left: sections ─────────────────────────── */

const SECTIONS: { vertical: FeedVertical; label: string; icon: typeof ShoppingBag }[] = [
  { vertical: "market", label: "Market", icon: ShoppingBag },
  { vertical: "business", label: "Business", icon: Building2 },
  { vertical: "tourism", label: "Tourism", icon: TreePalm },
];

const TOURISM_LABELS: Record<TourismKind, string> = {
  all: "Tourism",
  stays: "Stays",
  events: "Events",
};

export function SectionRail({
  vertical,
  tourismKind,
  busy,
  onSelect,
}: {
  vertical: FeedVertical;
  tourismKind: TourismKind;
  busy: FeedVertical | null;
  /** Choosing the section already shown opens its options (Tourism: all, stays, events). */
  onSelect: (vertical: FeedVertical) => void;
}) {
  return (
    <nav aria-label="Sections" data-vm-control className="flex flex-col items-center gap-3">
      {SECTIONS.map(({ vertical: value, label, icon: Icon }) => {
        const selected = value === vertical;
        const shown = value === "tourism" && selected ? TOURISM_LABELS[tourismKind] : label;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            disabled={busy !== null}
            aria-pressed={selected}
            aria-label={
              value === "tourism"
                ? selected
                  ? `Tourism and events: showing ${TOURISM_LABELS[tourismKind].toLowerCase()}. Choose what to show`
                  : "Tourism and events"
                : label
            }
            className={cn("flex w-14 flex-col items-center gap-1 rounded-2xl py-0.5", FOCUS)}
          >
            <span
              className={cn(
                VM_CIRCLE,
                selected && "bg-white text-brand-green-950 ring-2 ring-brand-gold-300"
              )}
            >
              {busy === value ? (
                <Loader2 className={cn(VM_GLYPH, "animate-spin")} aria-hidden="true" />
              ) : (
                <Icon className={VM_GLYPH} aria-hidden="true" />
              )}
            </span>
            {selected ? (
              <span className={RAIL_TEXT} aria-hidden="true">
                {shown}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

/* ─────────────────────────── Buttons ─────────────────────────── */

/** A 40px circle with a 44px touch target; an optional word or count underneath. */
export function CircleButton({
  label,
  text,
  onClick,
  disabled,
  pressed,
  className,
  children,
}: {
  label: string;
  text?: string | null;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      className={cn("flex min-w-11 flex-col items-center gap-1 rounded-2xl p-0.5", FOCUS)}
    >
      <span className={cn(VM_CIRCLE, className)}>{children}</span>
      {text ? (
        <span className={RAIL_TEXT} aria-hidden="true">
          {text}
        </span>
      ) : null}
    </button>
  );
}

/* ─────────────────────────── Right: views, like, enquire ─────────────────────────── */

export function ActionRail({ slide, views }: { slide: FeedSlide; views: number }) {
  return (
    <div
      role="group"
      aria-label="Post actions"
      data-vm-control
      className="vm-actions flex flex-col items-center gap-2.5"
    >
      {/* First, in the same circle as Like; not a button: views only count. */}
      <div className="flex min-w-11 flex-col items-center gap-1 p-0.5">
        <span className={VM_CIRCLE} aria-hidden="true">
          <Eye className={VM_GLYPH} />
        </span>
        <span className={RAIL_TEXT} aria-hidden="true">
          {formatCompactCount(views)}
        </span>
        <span className="sr-only">{views === 1 ? "1 view" : `${views} views`}</span>
      </div>

      <ContentLikeButton
        key={slide.key}
        variant="rail"
        className="vm-like"
        targetId={slide.id}
        targetType={slide.targetType}
        initialLikeCount={slide.engagement.likes}
        initialLiked={slide.engagement.viewerHasLiked}
      />

      {slide.contact.showMessageButton ? (
        <ContentEnquiryAction
          config={feedContactConfig(slide)}
          contentClassName={VM_DIALOG_SHEET}
          renderTrigger={(open) => (
            <CircleButton label="Send a private enquiry" text="Enquire" onClick={open}>
              <MessageSquare className={VM_GLYPH} aria-hidden="true" />
            </CircleButton>
          )}
        />
      ) : null}
    </div>
  );
}

/* ─────────────────────────── Bottom: details, contact, share, more ─────────────────────────── */

/** The quickest way to reach the owner: WhatsApp when they added it, else a phone call. */
function primaryContact(slide: FeedSlide) {
  const whatsapp = whatsappLink(slide.contact.whatsapp, slide.shareTitle, slide.href);
  if (whatsapp) return { kind: "whatsapp" as const, href: whatsapp };
  const phone = slide.contact.showPhoneButton ? contactPhone(slide.contact.phone) : null;
  if (phone) return { kind: "call" as const, href: `tel:${phone}`, phone };
  // Numbers aren't in public slides: the details page reveals them on tap.
  const revealable = slide.contact.revealable;
  return revealable?.phone || revealable?.whatsapp
    ? { kind: "reveal" as const, href: `${slide.href}#contact` }
    : null;
}

export function PostActionRow({
  slide,
  analytics,
  onDetails,
  onMore,
}: {
  slide: FeedSlide;
  analytics: boolean;
  onDetails: () => void;
  onMore: () => void;
}) {
  const { share, copied, shareCount, sharing, shareError } = useSharePost(slide, analytics);
  const contact = primaryContact(slide);
  return (
    <div className="relative flex items-center gap-1.5" data-vm-control>
      <Link
        href={slide.href}
        prefetch={false}
        onClick={onDetails}
        className={cn(
          "mr-1 inline-flex h-11 items-center gap-1 rounded-full bg-white pl-4 pr-3 text-sm font-semibold text-brand-green-950",
          FOCUS
        )}
      >
        Details
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">for {slide.title}</span>
      </Link>

      {contact?.kind === "whatsapp" ? (
        <a
          href={contact.href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          aria-label={`WhatsApp ${slide.owner.name}`}
          className={cn("rounded-full p-0.5", FOCUS)}
        >
          <span className={cn(VM_CIRCLE, "bg-[#128c4b]")}>
            <WhatsAppIcon className={VM_GLYPH} />
          </span>
        </a>
      ) : contact?.kind === "reveal" ? (
        <Link
          href={contact.href}
          prefetch={false}
          aria-label={`Contact ${slide.owner.name}`}
          className={cn("rounded-full p-0.5", FOCUS)}
        >
          <span className={cn(VM_CIRCLE, "bg-brand-green-700")}>
            <Phone className={VM_GLYPH} aria-hidden="true" />
          </span>
        </Link>
      ) : contact?.kind === "call" ? (
        <a
          href={contact.href}
          aria-label={`Call ${slide.owner.name} on ${contact.phone}`}
          className={cn("rounded-full p-0.5", FOCUS)}
        >
          <span className={cn(VM_CIRCLE, "bg-brand-green-700")}>
            <Phone className={VM_GLYPH} aria-hidden="true" />
          </span>
        </a>
      ) : null}

      <CircleButton
        label={
          copied
            ? "Link copied"
            : shareCount
              ? `Share this post. ${shareCount} recorded shares`
              : "Share this post"
        }
        onClick={() => void share()}
        disabled={sharing}
        className="relative"
      >
        {copied ? (
          <Check className={cn(VM_GLYPH, "text-emerald-300")} aria-hidden="true" />
        ) : (
          <Share2 className={VM_GLYPH} aria-hidden="true" />
        )}
        {shareCount ? (
          <span
            className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-gold-300 px-1 text-[10px] font-bold text-brand-gold-950"
            aria-hidden="true"
          >
            {formatCompactCount(shareCount)}
          </span>
        ) : null}
      </CircleButton>

      <CircleButton label="More options" onClick={onMore}>
        <MoreHorizontal className={VM_GLYPH} aria-hidden="true" />
      </CircleButton>

      <span
        className={
          shareError
            ? "absolute bottom-full left-0 mb-2 w-60 rounded-xl bg-brand-green-950 px-3 py-2 text-xs text-white shadow-lg"
            : "sr-only"
        }
        aria-live="polite"
      >
        {shareError ?? (copied ? "Link copied" : "")}
      </span>
    </div>
  );
}

/* ─────────────────────────── More sheet ─────────────────────────── */

const ROW =
  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function MoreSheet({
  slide,
  open,
  onOpenChange,
}: {
  slide: FeedSlide;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // A call already in the bottom row (no WhatsApp) is not offered twice; the booking or
  // ticket button sits with the post itself.
  const phone =
    slide.contact.showPhoneButton && primaryContact(slide)?.kind !== "call"
      ? contactPhone(slide.contact.phone)
      : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5"
      >
        <SheetHeader className="px-2 pb-2 text-left">
          <SheetTitle className="line-clamp-1 pr-10">{slide.title}</SheetTitle>
          <SheetDescription>More ways to reach the owner, and reporting.</SheetDescription>
        </SheetHeader>
        <div className="space-y-1">
          {phone ? (
            <a href={`tel:${phone}`} className={ROW}>
              <Phone className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              Call {phone}
            </a>
          ) : null}
          {slide.mapUrl ? (
            <a
              href={slide.mapUrl}
              data-contact-action="directions_click"
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className={ROW}
            >
              <MapPin className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              Directions
            </a>
          ) : null}
          {slide.website ? (
            <a
              href={slide.website}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className={ROW}
            >
              <Globe className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              Website
            </a>
          ) : null}
          <ReportDialog
            targetId={slide.id}
            targetType={slide.targetType}
            targetName={slide.title}
            triggerLabel="Report this post"
            className={cn(ROW, "h-auto justify-start [&_svg]:h-5 [&_svg]:w-5")}
            contentClassName={VM_DIALOG_SHEET}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─────────────────────────── Bottom: the post ─────────────────────────── */

export function PostInfo({ slide, headingLevel }: { slide: FeedSlide; headingLevel: "h1" | "h2" }) {
  const Heading = headingLevel;
  const figure = slide.headline.figure;
  // One line of facts, each shown once: an event's date, then the place.
  const facts = slide.headline.meta
    .filter((item) => item.icon === "location" || (item.icon === "date" && slide.kind === "event"))
    .sort((a, b) => (a.icon === "date" ? -1 : b.icon === "date" ? 1 : 0))
    .slice(0, 2);
  // Businesses and stays: whether it is worth calling right now.
  const open = slide.headline.hours ? getOpenStatus(slide.headline.hours) : null;
  const openLabel = open && open.state !== "unknown" ? open : null;
  const cta = slide.contact.cta;
  const owner = (
    <>
      {slide.owner.logoUrl ? (
        <Image
          src={slide.owner.logoUrl}
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 shrink-0 rounded-full bg-white object-contain p-0.5 ring-1 ring-white/40"
        />
      ) : (
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green-700 text-xs font-bold ring-1 ring-white/40"
          aria-hidden="true"
        >
          {slide.owner.initials}
        </span>
      )}
      <span className="truncate text-sm font-semibold">{slide.owner.name}</span>
    </>
  );
  return (
    <div className="vm-shadow space-y-1.5 text-white">
      <div className="flex min-w-0 items-center gap-2">
        {slide.owner.href ? (
          <Link
            href={slide.owner.href}
            prefetch={false}
            aria-label={`${slide.owner.label}: ${slide.owner.name}`}
            className={cn("-my-1.5 flex min-h-11 min-w-0 items-center gap-2 rounded-full", FOCUS)}
          >
            {owner}
          </Link>
        ) : (
          owner
        )}
        {slide.owner.trustLevel ? <TrustBadge level={slide.owner.trustLevel} size="sm" /> : null}
      </div>
      <Heading className="line-clamp-2 font-display text-lg font-bold leading-snug">
        {slide.title}
      </Heading>
      {figure || facts.length > 0 || openLabel ? (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-white/90">
          {figure ? (
            <span className="font-bold text-brand-gold-300">
              {figure.value}
              {figure.note ? (
                <span className="ml-1 text-xs font-medium text-white/80">{figure.note}</span>
              ) : null}
            </span>
          ) : null}
          {openLabel ? (
            <span className="flex items-center gap-1.5 font-medium">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  openLabel.state === "open" ? "bg-emerald-400" : "bg-white/50"
                )}
                aria-hidden="true"
              />
              {openLabel.label}
            </span>
          ) : null}
          {facts.map((item) => (
            <span key={`${item.icon}:${item.text}`} className="flex min-w-0 items-center gap-1">
              {item.icon === "date" ? (
                <CalendarCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{item.text}</span>
            </span>
          ))}
        </p>
      ) : null}
      {cta ? (
        // Booking or tickets is the main step for stays and events, so it stays in view.
        <a
          href={cta.href}
          data-contact-action={cta.icon === "tickets" ? "ticket_click" : "booking_click"}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          data-vm-control
          className={cn(
            "!mt-2.5 inline-flex h-11 items-center gap-1.5 rounded-full bg-brand-gold-300 px-4 text-sm font-semibold text-brand-gold-950 [text-shadow:none]",
            FOCUS
          )}
        >
          {cta.icon === "tickets" ? (
            <Ticket className="h-4 w-4" aria-hidden="true" />
          ) : (
            <CalendarCheck className="h-4 w-4" aria-hidden="true" />
          )}
          {cta.label}
        </a>
      ) : null}
    </div>
  );
}
