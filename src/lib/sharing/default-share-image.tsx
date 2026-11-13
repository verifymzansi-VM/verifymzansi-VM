// The site-wide link-preview picture (/opengraph-image and /twitter-image).
// It never changes between requests, so it is drawn once, ahead of time, by
// scripts/generate-default-share-image.mjs with the same Workers renderer the
// site used (@vercel/og), and the website serves the stored PNG
// (default-share-image-png.ts). After changing this design, run
// `pnpm share-image:default` and commit both files.
import shieldData from "@/lib/brand-shield-data.json";
import type { CSSProperties } from "react";

export const DEFAULT_SHARE_IMAGE_SIZE = {
  width: 1200,
  height: 630,
};

const containerStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  width: "100%",
  height: "100%",
  padding: 56,
  backgroundColor: "#13100e",
  color: "#faf8f5",
};

const frameStyle: CSSProperties = {
  position: "absolute",
  inset: 24,
  borderRadius: 28,
  border: "1px solid rgba(255, 255, 255, 0.1)",
};

const glowStyle: CSSProperties = {
  position: "absolute",
  top: -80,
  right: -80,
  width: 340,
  height: 340,
  borderRadius: 9999,
  backgroundColor: "rgba(0, 131, 62, 0.1)",
};

const contentStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  width: "100%",
  height: "100%",
  flexDirection: "column",
  justifyContent: "space-between",
  borderRadius: 24,
};

const brandRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 28,
};

const brandTextStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const eyebrowStyle: CSSProperties = {
  marginBottom: 12,
  fontSize: 22,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.34em",
  color: "rgba(255, 255, 255, 0.65)",
};

const wordmarkStyle: CSSProperties = {
  display: "flex",
  fontSize: 74,
  fontWeight: 600,
  lineHeight: 1,
  letterSpacing: "-0.06em",
};

const accentBarStyle: CSSProperties = {
  marginTop: 18,
  width: 112,
  height: 8,
  borderRadius: 9999,
  backgroundImage: "linear-gradient(90deg, #ffb81c 0%, #00833e 55%, #006b32 100%)",
};

const copyWrapStyle: CSSProperties = {
  display: "flex",
  maxWidth: 820,
  flexDirection: "column",
  gap: 18,
};

const headlineStyle: CSSProperties = {
  fontSize: 64,
  fontWeight: 700,
  lineHeight: 1.05,
  letterSpacing: "-0.045em",
};

const subheadStyle: CSSProperties = {
  fontSize: 28,
  lineHeight: 1.35,
  color: "rgba(255, 255, 255, 0.8)",
};

export function defaultShareImage() {
  return (
    <div style={containerStyle}>
      <div style={frameStyle} />
      <div style={glowStyle} />

      <div style={contentStyle}>
        <div style={brandRowStyle}>
          {/* ImageResponse renders native images into the social card. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse requires native img elements. */}
          <img src={shieldData} alt="VerifyMzansi shield" width={128} height={128} />

          <div style={brandTextStyle}>
            <div style={eyebrowStyle}>Discover · Connect</div>
            <div style={wordmarkStyle}>
              <span style={{ color: "#fffaf5" }}>Verify</span>
              <span style={{ color: "#b4e2c0" }}>Mzansi</span>
            </div>
            <div style={accentBarStyle} />
          </div>
        </div>

        <div style={copyWrapStyle}>
          <div style={headlineStyle}>Do business with confidence.</div>
          <div style={subheadStyle}>
            Discover local products, businesses, services, stays and events across South Africa.
          </div>
        </div>
      </div>
    </div>
  );
}
