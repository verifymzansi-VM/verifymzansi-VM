import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * 12-second portrait explainer for the /advertise page: sell something, record a short video,
 * get identity-reviewed, buyers contact you directly. Motion graphics only, no real footage
 * or fabricated results.
 */

const c = {
  green950: "#052e25",
  green900: "#08624a",
  green700: "#0b7a55",
  green300: "#6ee7b7",
  gold: "#f9a826",
  gold300: "#fcd34d",
  white: "#ffffff",
  soft: "rgba(255,255,255,0.78)",
  whatsapp: "#25d366",
};

const font = '"Segoe UI", "Trebuchet MS", system-ui, sans-serif';

const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
const progress = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

/** Fades a scene in over 10 frames and out over the last 10. */
const Scene = ({ children, length }: { children: ReactNode; length: number }) => {
  const frame = useCurrentFrame();
  const opacity = Math.min(
    interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" }),
    interpolate(frame, [length - 10, length], [1, 0], { extrapolateLeft: "clamp" })
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const Headline = ({
  children,
  size = 120,
  style,
}: {
  children: ReactNode;
  size?: number;
  style?: CSSProperties;
}) => {
  const frame = useCurrentFrame();
  const p = progress(frame, 4, 24);
  return (
    <div
      style={{
        fontSize: size,
        lineHeight: 1.02,
        fontWeight: 900,
        letterSpacing: -2,
        color: c.white,
        opacity: p,
        transform: `translateY(${(1 - p) * 50}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const Gold = ({ children }: { children: ReactNode }) => (
  <span style={{ color: c.gold300 }}>{children}</span>
);

const Backdrop = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 40) * 60;
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `linear-gradient(165deg, ${c.green700} 0%, ${c.green900} 40%, ${c.green950} 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -200 + drift,
          top: 300,
          width: 720,
          height: 720,
          borderRadius: "50%",
          background: "rgba(249,168,38,0.28)",
          filter: "blur(140px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -260 - drift,
          bottom: 200,
          width: 760,
          height: 760,
          borderRadius: "50%",
          background: "rgba(110,231,183,0.22)",
          filter: "blur(150px)",
        }}
      />
      {/* South African flag stripe */}
      <div
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 14, display: "flex" }}
      >
        {["#007a4d", "#ffb612", "#ffffff", "#de3831", "#ffffff", "#002395", "#000000"].map(
          (color, i) => (
            <div key={i} style={{ flex: 1, background: color }} />
          )
        )}
      </div>
    </AbsoluteFill>
  );
};

const Chip = ({ children, delay = 0 }: { children: ReactNode; delay?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 120 } });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 16,
        padding: "20px 36px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.12)",
        border: "2px solid rgba(255,255,255,0.22)",
        color: c.white,
        fontSize: 44,
        fontWeight: 800,
        transform: `scale(${s})`,
        opacity: Math.min(1, s),
      }}
    >
      {children}
    </div>
  );
};

/** ── Scene 1: hook ─────────────────────────────────────────────── */
const Hook = () => {
  const frame = useCurrentFrame();
  const second = progress(frame, 28, 48);
  return (
    <AbsoluteFill style={{ padding: "0 90px", justifyContent: "center" }}>
      <Headline size={150}>Selling something?</Headline>
      <div
        style={{
          marginTop: 40,
          fontSize: 150,
          lineHeight: 1,
          fontWeight: 900,
          letterSpacing: -3,
          color: c.gold300,
          opacity: second,
          transform: `translateY(${(1 - second) * 50}px)`,
        }}
      >
        Show it.
      </div>
    </AbsoluteFill>
  );
};

/** ── Scene 2: record a short video ─────────────────────────────── */
const Car = ({ x }: { x: number }) => (
  <div style={{ position: "absolute", left: x, bottom: 150, width: 460, height: 190 }}>
    <div
      style={{
        position: "absolute",
        left: 70,
        top: 0,
        width: 290,
        height: 100,
        borderRadius: "90px 110px 0 0",
        background: "#e8eef2",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 100,
        top: 18,
        width: 110,
        height: 64,
        borderRadius: "40px 20px 0 0",
        background: "#4b6b7a",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 224,
        top: 18,
        width: 110,
        height: 64,
        borderRadius: "20px 50px 0 0",
        background: "#4b6b7a",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 80,
        width: 460,
        height: 80,
        borderRadius: 34,
        background: "#f5f7f8",
        boxShadow: "0 12px 30px rgba(0,0,0,0.3)",
      }}
    />
    {[80, 330].map((left) => (
      <div
        key={left}
        style={{
          position: "absolute",
          left,
          top: 118,
          width: 78,
          height: 78,
          borderRadius: "50%",
          background: "#1f2933",
          border: "10px solid #cbd5dc",
        }}
      />
    ))}
  </div>
);

const Record = () => {
  const frame = useCurrentFrame();
  const pop = progress(frame, 0, 20);
  const pan = interpolate(frame, [0, 90], [140, -110]);
  const blink = Math.floor(frame / 15) % 2 === 0;
  const secs = Math.min(15, Math.floor(frame / 6));
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
      <div
        style={{
          width: 560,
          height: 1000,
          borderRadius: 74,
          border: "14px solid #021a15",
          background: "linear-gradient(180deg,#bfe8d6 0%, #7fc4a6 55%, #4d9a7c 100%)",
          overflow: "hidden",
          position: "relative",
          transform: `scale(${0.85 + pop * 0.15})`,
          opacity: pop,
          boxShadow: "0 50px 120px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 210,
            background: "#2f4a42",
          }}
        />
        <Car x={pan} />
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 20px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.5)",
            color: c.white,
            fontSize: 30,
            fontWeight: 800,
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#ef4444",
              opacity: blink ? 1 : 0.25,
            }}
          />
          REC 0:{String(secs).padStart(2, "0")}
        </div>
        {/* focus corners */}
        {[
          { top: 120, left: 60 },
          { top: 120, right: 60 },
          { bottom: 120, left: 60 },
          { bottom: 120, right: 60 },
        ].map((pos, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: 56,
              height: 56,
              border: `6px solid ${c.white}`,
              borderRadius: 10,
              opacity: 0.8,
              ...pos,
              borderTopColor: "top" in pos ? c.white : "transparent",
              borderBottomColor: "bottom" in pos ? c.white : "transparent",
              borderLeftColor: "left" in pos ? c.white : "transparent",
              borderRightColor: "right" in pos ? c.white : "transparent",
            }}
          />
        ))}
      </div>
      <div style={{ marginTop: 70, padding: "0 90px", textAlign: "center" }}>
        <Headline size={96} style={{ textAlign: "center" }}>
          Record a <Gold>short video.</Gold>
        </Headline>
      </div>
    </AbsoluteFill>
  );
};

/** ── Scene 3: identity reviewed ────────────────────────────────── */
const Verified = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const badge = spring({ frame: frame - 6, fps, config: { damping: 9, stiffness: 110 } });
  const items = [
    "Phone confirmed",
    "SA ID and live selfie reviewed",
    "Post checked before it goes live",
  ];
  return (
    <AbsoluteFill style={{ padding: "0 90px", justifyContent: "center", gap: 50 }}>
      <div
        style={{
          width: 250,
          height: 250,
          borderRadius: "50%",
          background: `linear-gradient(145deg, ${c.gold300}, ${c.gold})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${badge}) rotate(${(1 - badge) * -25}deg)`,
          boxShadow: "0 0 90px rgba(249,168,38,0.55)",
        }}
      >
        <svg
          width="140"
          height="140"
          viewBox="0 0 24 24"
          fill="none"
          stroke={c.green950}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <Headline size={120}>
        Buyers see you&rsquo;re <Gold>real.</Gold>
      </Headline>
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {items.map((label, i) => {
          const p = progress(frame, 26 + i * 14, 42 + i * 14);
          return (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 24,
                fontSize: 48,
                fontWeight: 700,
                color: c.white,
                opacity: p,
                transform: `translateX(${(1 - p) * -60}px)`,
              }}
            >
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: "50%",
                  background: c.green300,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={c.green950}
                  strokeWidth="3.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </div>
              {label}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** ── Scene 4: direct contact ───────────────────────────────────── */
const Contact = () => {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 5) * 0.03;
  const pop = (delay: number) => progress(frame, delay, delay + 16);
  return (
    <AbsoluteFill style={{ padding: "0 90px", justifyContent: "center", gap: 56 }}>
      <Headline size={120}>
        Buyers contact <Gold>you.</Gold>
      </Headline>
      <div style={{ fontSize: 54, fontWeight: 600, color: c.soft, opacity: pop(18) }}>
        Straight to your phone. No commission.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
        {[
          { label: "Call", bg: c.white, fg: c.green950, delay: 24 },
          { label: "WhatsApp", bg: c.whatsapp, fg: c.green950, delay: 34 },
        ].map(({ label, bg, fg, delay }) => (
          <div
            key={label}
            style={{
              height: 150,
              borderRadius: 999,
              background: bg,
              color: fg,
              fontSize: 64,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: pop(delay),
              transform: `translateY(${(1 - pop(delay)) * 60}px) scale(${pulse})`,
              boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** ── Scene 5: end card ─────────────────────────────────────────── */
const EndCard = () => {
  const frame = useCurrentFrame();
  const logo = progress(frame, 0, 20);
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", gap: 50, padding: "0 90px" }}
    >
      <Img
        src={staticFile("images/logo-inverse.png")}
        style={{ width: 560, opacity: logo, transform: `scale(${0.85 + logo * 0.15})` }}
      />
      <Headline size={104} style={{ textAlign: "center" }}>
        Your first post is <Gold>free</Gold> for 7 days.
      </Headline>
      <Chip delay={24}>verifymzansi.com</Chip>
    </AbsoluteFill>
  );
};

export const AdvertisePromo = () => (
  <AbsoluteFill style={{ fontFamily: font }}>
    <Backdrop />
    <Sequence from={0} durationInFrames={80}>
      <Scene length={80}>
        <Hook />
      </Scene>
    </Sequence>
    <Sequence from={70} durationInFrames={100}>
      <Scene length={100}>
        <Record />
      </Scene>
    </Sequence>
    <Sequence from={160} durationInFrames={90}>
      <Scene length={90}>
        <Verified />
      </Scene>
    </Sequence>
    <Sequence from={240} durationInFrames={70}>
      <Scene length={70}>
        <Contact />
      </Scene>
    </Sequence>
    <Sequence from={300} durationInFrames={60}>
      <Scene length={60}>
        <EndCard />
      </Scene>
    </Sequence>
  </AbsoluteFill>
);
