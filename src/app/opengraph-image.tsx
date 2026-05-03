import { ImageResponse } from "next/og";
import type { CSSProperties } from "react";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

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

const shieldBadgeStyle: CSSProperties = {
  display: "flex",
  width: 128,
  height: 128,
  borderRadius: 28,
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(145deg, #0f3d2f 0%, #00833e 58%, #00a14b 100%)",
  border: "2px solid rgba(255, 255, 255, 0.28)",
  boxShadow: "0 14px 30px rgba(0, 0, 0, 0.35)",
};

const shieldTextStyle: CSSProperties = {
  fontSize: 48,
  fontWeight: 800,
  letterSpacing: "-0.04em",
  color: "#fffaf5",
  lineHeight: 1,
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

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={containerStyle}>
      <div style={frameStyle} />
      <div style={glowStyle} />

      <div style={contentStyle}>
        <div style={brandRowStyle}>
          <div style={shieldBadgeStyle}>
            <div style={shieldTextStyle}>VM</div>
          </div>

          <div style={brandTextStyle}>
            <div style={eyebrowStyle}>Find And Post With Trust</div>
            <div style={wordmarkStyle}>
              <span style={{ color: "#fffaf5" }}>Verify</span>
              <span style={{ color: "#b4e2c0" }}>Mzansi</span>
            </div>
            <div style={accentBarStyle} />
          </div>
        </div>

        <div style={copyWrapStyle}>
          <div style={headlineStyle}>South African listings, business, tourism, and events.</div>
          <div style={subheadStyle}>
            Browse or post local listings, business services, tourism stays, experiences, venues,
            and live events.
          </div>
        </div>
      </div>
    </div>,
    size
  );
}
