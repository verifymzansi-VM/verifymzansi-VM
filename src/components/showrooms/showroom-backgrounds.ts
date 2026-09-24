import type { ShowroomDecorativeBackground } from "./showroom-section-shell";

export const generatedMzansiShowroomBackground: ShowroomDecorativeBackground = {
  src: "/images/showrooms/home-v2-desktop.avif",
  mobileSrc: "/images/showrooms/home-v2-mobile.avif",
  objectPosition: "center",
  mobileObjectPosition: "center",
  overlayPreset: "market",
  blurPx: 0,
  dimOpacity: 0.08,
};

export const mzansiBusinessShowroomBackground: ShowroomDecorativeBackground = {
  ...generatedMzansiShowroomBackground,
  src: "/images/showrooms/business-v2-desktop.avif",
  mobileSrc: "/images/showrooms/business-v2-mobile.avif",
  overlayPreset: "business",
};

export const tourismEventsShowroomBackground: ShowroomDecorativeBackground = {
  ...generatedMzansiShowroomBackground,
  src: "/images/showrooms/tourism-v2-desktop.avif",
  mobileSrc: "/images/showrooms/tourism-v2-mobile.avif",
  overlayPreset: "tourism",
};

export const mzansiMarketShowroomBackground: ShowroomDecorativeBackground = {
  ...generatedMzansiShowroomBackground,
  src: "/images/showrooms/market-v2-desktop.avif",
  mobileSrc: "/images/showrooms/market-v2-mobile.avif",
  overlayPreset: "market",
};
