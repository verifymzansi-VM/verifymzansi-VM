import type { ShowroomDecorativeBackground } from "./showroom-card-carousel";

export const generatedMzansiShowroomBackground: ShowroomDecorativeBackground = {
  src: "/images/showrooms/generated-mzansi-showroom.webp",
  objectPosition: "center 48%",
  mobileObjectPosition: "center 48%",
  overlayPreset: "market",
  blurPx: 0,
  dimOpacity: 0.08,
};

export const mzansiBusinessShowroomBackground: ShowroomDecorativeBackground = {
  ...generatedMzansiShowroomBackground,
  objectPosition: "center 48%",
  mobileObjectPosition: "center 48%",
  overlayPreset: "business",
};

export const tourismEventsShowroomBackground: ShowroomDecorativeBackground = {
  ...generatedMzansiShowroomBackground,
  objectPosition: "center 48%",
  mobileObjectPosition: "center 48%",
  overlayPreset: "tourism",
};

export const mzansiMarketShowroomBackground: ShowroomDecorativeBackground = {
  ...generatedMzansiShowroomBackground,
  overlayPreset: "market",
};
