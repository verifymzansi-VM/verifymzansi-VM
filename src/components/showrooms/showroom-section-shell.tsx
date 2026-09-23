import Image from "next/image";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

export type ShowroomBackgroundOverlayPreset = "market" | "business" | "tourism";

export interface ShowroomDecorativeBackground {
  src: string;
  mobileSrc?: string;
  objectPosition?: string;
  mobileObjectPosition?: string;
  overlayPreset?: ShowroomBackgroundOverlayPreset;
  blurPx?: number;
  dimOpacity?: number;
}

const SECTION_SURFACE =
  "bg-[linear-gradient(180deg,#faf8f3_0%,#f3eee4_52%,#ece5d6_100%)] dark:bg-[linear-gradient(180deg,#0c0f14_0%,#0a0d12_52%,#080a0f_100%)]";

export function getBackgroundOverlayClasses(preset: ShowroomBackgroundOverlayPreset = "market") {
  switch (preset) {
    case "business":
      return {
        wash: "bg-[linear-gradient(180deg,rgba(246,246,244,0.24)_0%,rgba(229,234,240,0.12)_38%,rgba(15,23,42,0.18)_100%)]",
        accent:
          "bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.08),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(148,163,184,0.06),transparent_32%)]",
        edgeLeft: "bg-gradient-to-r from-slate-950/10 via-slate-950/2 to-transparent",
        edgeRight: "bg-gradient-to-l from-slate-950/8 via-slate-950/2 to-transparent",
        topGlow:
          "bg-[radial-gradient(circle,rgba(255,255,255,0.32)_0%,rgba(219,234,254,0.12)_45%,transparent_72%)]",
        bottomGlow:
          "bg-[radial-gradient(circle,rgba(15,23,42,0.42)_0%,rgba(30,41,59,0.12)_40%,transparent_72%)]",
      };
    case "tourism":
      return {
        wash: "bg-[linear-gradient(180deg,rgba(238,246,255,0.2)_0%,rgba(234,239,244,0.08)_32%,rgba(15,23,42,0.16)_100%)]",
        accent:
          "bg-[radial-gradient(circle_at_top_right,rgba(125,211,252,0.08),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.07),transparent_32%)]",
        edgeLeft: "bg-gradient-to-r from-slate-950/8 via-slate-950/2 to-transparent",
        edgeRight: "bg-gradient-to-l from-slate-950/6 via-slate-950/1 to-transparent",
        topGlow:
          "bg-[radial-gradient(circle,rgba(219,234,254,0.34)_0%,rgba(255,255,255,0.08)_45%,transparent_72%)]",
        bottomGlow:
          "bg-[radial-gradient(circle,rgba(15,23,42,0.32)_0%,rgba(15,23,42,0.08)_40%,transparent_72%)]",
      };
    case "market":
    default:
      return {
        wash: "bg-[linear-gradient(180deg,rgba(250,246,239,0.24)_0%,rgba(241,232,218,0.12)_38%,rgba(15,23,42,0.18)_100%)]",
        accent:
          "bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.07),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(245,158,11,0.05),transparent_30%)]",
        edgeLeft: "bg-gradient-to-r from-slate-950/8 via-slate-950/2 to-transparent",
        edgeRight: "bg-gradient-to-l from-slate-950/7 via-slate-950/2 to-transparent",
        topGlow:
          "bg-[radial-gradient(circle,rgba(255,255,255,0.36)_0%,rgba(255,255,255,0.08)_45%,transparent_72%)]",
        bottomGlow:
          "bg-[radial-gradient(circle,rgba(15,23,42,0.38)_0%,rgba(15,23,42,0.1)_40%,transparent_72%)]",
      };
  }
}

export function ShowroomSectionShell({
  children,
  sectionRef,
  sectionClassName,
  extraClassName,
  background,
}: {
  children: ReactNode;
  sectionRef?: Ref<HTMLDivElement>;
  sectionClassName: string;
  extraClassName?: string;
  background?: ShowroomDecorativeBackground;
}) {
  const hasBackground = Boolean(background?.src);
  const overlayClasses = getBackgroundOverlayClasses(background?.overlayPreset);
  const backgroundFilter = `blur(${background?.blurPx ?? 18}px) saturate(0.82) brightness(0.78)`;
  const backgroundSrc = background?.src ?? "";
  const mobileBackgroundSrc = background?.mobileSrc ?? backgroundSrc;
  const desktopPosition = background?.objectPosition ?? "center";
  const mobilePosition = background?.mobileObjectPosition ?? desktopPosition;
  const usesSameResponsiveBackground = backgroundSrc === mobileBackgroundSrc;

  return (
    <section
      ref={sectionRef}
      className={cn(
        "relative w-full overflow-hidden",
        SECTION_SURFACE,
        sectionClassName,
        extraClassName
      )}
      aria-roledescription="carousel"
      aria-label="Showroom carousel"
    >
      {hasBackground ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
          aria-hidden="true"
        >
          {usesSameResponsiveBackground ? (
            <Image
              src={backgroundSrc}
              alt=""
              fill
              sizes="100vw"
              preload
              fetchPriority="high"
              className="object-cover scale-[1.12] md:scale-[1.08] lg:scale-[1.04]"
              style={{ objectPosition: mobilePosition, filter: backgroundFilter }}
              data-showroom-background="shared"
            />
          ) : (
            <>
              <Image
                src={backgroundSrc}
                alt=""
                fill
                sizes="100vw"
                fetchPriority="high"
                className={cn("hidden object-cover md:block", "scale-[1.08] lg:scale-[1.04]")}
                style={{ objectPosition: desktopPosition, filter: backgroundFilter }}
                data-showroom-background="desktop"
              />
              <Image
                src={mobileBackgroundSrc}
                alt=""
                fill
                sizes="100vw"
                fetchPriority="high"
                className="object-cover md:hidden scale-[1.12]"
                style={{ objectPosition: mobilePosition, filter: backgroundFilter }}
                data-showroom-background="mobile"
              />
            </>
          )}
          <div
            className="absolute inset-0 bg-slate-950"
            style={{ opacity: background?.dimOpacity ?? 0.44 }}
          />
        </div>
      ) : null}
      <div
        className={cn(
          "absolute inset-0 z-[1]",
          hasBackground
            ? overlayClasses.wash
            : "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.88),transparent_30%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.08),rgba(15,23,42,0.06)_48%,rgba(15,23,42,0.12)_100%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_32%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.08),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(0,0,0,0.12)_48%,rgba(0,0,0,0.28)_100%)]"
        )}
        aria-hidden="true"
      />
      {hasBackground ? (
        <div className={cn("absolute inset-0 z-[1]", overlayClasses.accent)} aria-hidden="true" />
      ) : null}
      <div
        className={cn(
          "absolute inset-y-0 left-0 z-[1] w-[24%]",
          hasBackground
            ? overlayClasses.edgeLeft
            : "bg-gradient-to-r from-slate-950/10 via-slate-950/0 to-transparent"
        )}
        aria-hidden="true"
      />
      <div
        className={cn(
          "absolute inset-y-0 right-0 z-[1] w-[24%]",
          hasBackground
            ? overlayClasses.edgeRight
            : "bg-gradient-to-l from-slate-950/8 via-slate-950/0 to-transparent"
        )}
        aria-hidden="true"
      />
      {/* Content above the flag */}
      <div className="relative z-10">{children}</div>
    </section>
  );
}
