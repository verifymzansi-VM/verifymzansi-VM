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
 * 30-second portrait advert for the public (buyers): is the seller real? On VerifyMzansi they
 * are identity-reviewed, you can watch the item on video first, then call or WhatsApp them.
 * Motion graphics only, no real footage, people or fabricated results. Silent by design
 * (captions carry the story).
 */

const c = {
  green950: "#052e25",
  green900: "#08624a",
  green700: "#0b7a55",
  green300: "#6ee7b7",
  gold: "#f9a826",
  gold300: "#fcd34d",
  blue: "#3b82f6",
  teal: "#14b8a6",
  white: "#ffffff",
  soft: "rgba(255,255,255,0.78)",
  whatsapp: "#25d366",
  red: "#ef4444",
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
  delay = 4,
  style,
}: {
  children: ReactNode;
  size?: number;
  delay?: number;
  style?: CSSProperties;
}) => {
  const frame = useCurrentFrame();
  const p = progress(frame, delay, delay + 20);
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

const Tick = ({ size = 54, bg = c.green300 }: { size?: number; bg?: string }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}
  >
    <svg
      width={size * 0.6}
      height={size * 0.6}
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
          background: "rgba(249,168,38,0.24)",
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
          background: "rgba(110,231,183,0.2)",
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

const Chip = ({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: CSSProperties;
}) => {
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
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** A simple drawn couch, standing in for "the item" (no stock photos). */
const Couch = () => (
  <div style={{ position: "relative", width: 420, height: 200 }}>
    <div
      style={{
        position: "absolute",
        left: 40,
        top: 0,
        width: 340,
        height: 110,
        borderRadius: "40px 40px 10px 10px",
        background: "#c2703d",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 80,
        width: 420,
        height: 90,
        borderRadius: 30,
        background: "#d9844d",
        boxShadow: "0 16px 30px rgba(0,0,0,0.25)",
      }}
    />
    {[30, 370].map((left) => (
      <div
        key={left}
        style={{
          position: "absolute",
          left,
          top: 165,
          width: 20,
          height: 35,
          borderRadius: 6,
          background: "#4a2c1a",
        }}
      />
    ))}
  </div>
);

/** ── Scene 1: hook ─────────────────────────────────────────────── */
const Hook = () => {
  const frame = useCurrentFrame();
  const q = progress(frame, 34, 54);
  return (
    <AbsoluteFill style={{ padding: "0 90px", justifyContent: "center" }}>
      <Headline size={140}>Found a great deal online?</Headline>
      <div
        style={{
          marginTop: 50,
          fontSize: 140,
          lineHeight: 1,
          fontWeight: 900,
          letterSpacing: -3,
          color: c.gold300,
          opacity: q,
          transform: `translateY(${(1 - q) * 50}px) rotate(${(1 - q) * -3}deg)`,
        }}
      >
        Is the seller real?
      </div>
    </AbsoluteFill>
  );
};

/** ── Scene 2: verified seller card ─────────────────────────────── */
const VerifiedSeller = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = spring({ frame: frame - 4, fps, config: { damping: 14, stiffness: 100 } });
  const pill = spring({ frame: frame - 70, fps, config: { damping: 9, stiffness: 120 } });
  const checks = [
    "Phone confirmed",
    "SA ID and live selfie reviewed",
    "Post checked before it goes live",
  ];
  return (
    <AbsoluteFill style={{ padding: "0 90px", justifyContent: "center", gap: 56 }}>
      <Headline size={104}>
        On VerifyMzansi, sellers are <Gold>checked.</Gold>
      </Headline>
      <div
        style={{
          position: "relative",
          borderRadius: 44,
          background: c.white,
          padding: 44,
          display: "flex",
          flexDirection: "column",
          gap: 30,
          transform: `translateY(${(1 - card) * 120}px) scale(${0.92 + card * 0.08})`,
          opacity: Math.min(1, card),
          boxShadow: "0 40px 100px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <div
            style={{
              width: 110,
              height: 110,
              borderRadius: "50%",
              background: `linear-gradient(145deg, ${c.green700}, ${c.green950})`,
              color: c.white,
              fontSize: 50,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            TM
          </div>
          <div>
            <div style={{ fontSize: 48, fontWeight: 900, color: c.green950 }}>Thabo M.</div>
            <div style={{ fontSize: 34, fontWeight: 600, color: "#475569" }}>Seller · Market</div>
          </div>
        </div>
        {checks.map((label, i) => {
          const p = progress(frame, 24 + i * 14, 40 + i * 14);
          return (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                fontSize: 40,
                fontWeight: 700,
                color: c.green950,
                opacity: p,
                transform: `translateX(${(1 - p) * -50}px)`,
              }}
            >
              <Tick size={50} />
              {label}
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            top: -36,
            right: 30,
            padding: "16px 30px",
            borderRadius: 999,
            background: `linear-gradient(145deg, ${c.gold300}, ${c.gold})`,
            color: c.green950,
            fontSize: 36,
            fontWeight: 900,
            transform: `scale(${pill}) rotate(${(1 - pill) * 20}deg)`,
            boxShadow: "0 0 60px rgba(249,168,38,0.6)",
          }}
        >
          Verified seller
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** ── Scene 3: watch the video first ────────────────────────────── */
const WatchFirst = () => {
  const frame = useCurrentFrame();
  const pop = progress(frame, 0, 20);
  const played = interpolate(frame, [20, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sway = Math.sin(frame / 14) * 18;
  const playVisible = interpolate(frame, [14, 24], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
      <div
        style={{
          width: 560,
          height: 960,
          borderRadius: 74,
          border: "14px solid #021a15",
          background: "linear-gradient(180deg,#f3e8d8 0%, #e7d5bb 62%, #b88f64 62%, #9c7550 100%)",
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
            left: 70 + sway,
            top: 420,
          }}
        >
          <Couch />
        </div>
        <div
          style={{
            position: "absolute",
            top: 32,
            left: 28,
            padding: "10px 22px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.55)",
            color: c.white,
            fontSize: 30,
            fontWeight: 800,
          }}
        >
          Couch · R2 500
        </div>
        {/* play button, fades as video starts */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "42%",
            width: 150,
            height: 150,
            marginLeft: -75,
            marginTop: -75,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: playVisible,
          }}
        >
          <svg width="70" height="70" viewBox="0 0 24 24" fill={c.white}>
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        {/* progress bar */}
        <div
          style={{
            position: "absolute",
            left: 28,
            right: 28,
            bottom: 40,
            height: 12,
            borderRadius: 6,
            background: "rgba(255,255,255,0.45)",
          }}
        >
          <div
            style={{
              width: `${played * 100}%`,
              height: "100%",
              borderRadius: 6,
              background: c.gold300,
            }}
          />
        </div>
      </div>
      <div style={{ marginTop: 70, padding: "0 80px", textAlign: "center" }}>
        <Headline size={92} style={{ textAlign: "center" }}>
          Watch it on video <Gold>before you go.</Gold>
        </Headline>
      </div>
    </AbsoluteFill>
  );
};

/** ── Scene 4: three ways to find ───────────────────────────────── */
const Categories = () => {
  const frame = useCurrentFrame();
  const rows = [
    { name: "Market", line: "Deals near you", color: c.green300 },
    { name: "Business", line: "Local services you can trust", color: c.blue },
    { name: "Tourism", line: "Places, stays and events", color: c.teal },
  ];
  return (
    <AbsoluteFill style={{ padding: "0 90px", justifyContent: "center", gap: 60 }}>
      <Headline size={116}>
        Find it <Gold>local.</Gold>
      </Headline>
      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        {rows.map(({ name, line, color }, i) => {
          const p = progress(frame, 18 + i * 12, 36 + i * 12);
          return (
            <div
              key={name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 32,
                padding: "34px 40px",
                borderRadius: 36,
                background: "rgba(255,255,255,0.06)",
                border: "2px solid rgba(255,255,255,0.12)",
                borderLeft: `14px solid ${color}`,
                opacity: p,
                transform: `translateX(${(1 - p) * 120}px)`,
              }}
            >
              <div>
                <div style={{ fontSize: 64, fontWeight: 900, color: c.white }}>{name}</div>
                <div style={{ fontSize: 40, fontWeight: 600, color: c.soft }}>{line}</div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** ── Scene 5: direct contact + report ──────────────────────────── */
const Contact = () => {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 5) * 0.03;
  const pop = (delay: number) => progress(frame, delay, delay + 16);
  return (
    <AbsoluteFill style={{ padding: "0 90px", justifyContent: "center", gap: 56 }}>
      <Headline size={116}>
        Talk to the seller <Gold>directly.</Gold>
      </Headline>
      <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
        {[
          { label: "Call", bg: c.white, fg: c.green950, delay: 20 },
          { label: "WhatsApp", bg: c.whatsapp, fg: c.green950, delay: 30 },
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          fontSize: 46,
          fontWeight: 700,
          color: c.soft,
          opacity: pop(60),
          transform: `translateY(${(1 - pop(60)) * 30}px)`,
        }}
      >
        <svg
          width="54"
          height="54"
          viewBox="0 0 24 24"
          fill="none"
          stroke={c.gold300}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 22V4M4 4h12l-2 4 2 4H4" />
        </svg>
        Something off? Report it in one tap.
      </div>
    </AbsoluteFill>
  );
};

/** ── Scene 6: end card ─────────────────────────────────────────── */
const EndCard = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shield = spring({ frame: frame - 2, fps, config: { damping: 11, stiffness: 90 } });
  const logo = progress(frame, 22, 42);
  const glow = 0.45 + Math.sin(frame / 8) * 0.15;
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", gap: 46, padding: "0 90px" }}
    >
      <Img
        src={staticFile("images/brand-shield.png")}
        style={{
          width: 300,
          transform: `scale(${shield})`,
          filter: `drop-shadow(0 0 60px rgba(249,168,38,${glow}))`,
        }}
      />
      <div
        style={{
          fontSize: 84,
          fontWeight: 900,
          letterSpacing: -1,
          color: c.white,
          opacity: logo,
          transform: `scale(${0.85 + logo * 0.15})`,
        }}
      >
        Verify<span style={{ color: c.gold300 }}>Mzansi</span>
      </div>
      <Headline size={112} delay={34} style={{ textAlign: "center" }}>
        Buy local.
        <br />
        Buy <Gold>verified.</Gold>
      </Headline>
      <Chip delay={60}>verifymzansi.com</Chip>
    </AbsoluteFill>
  );
};

export const BuyerPromo = () => (
  <AbsoluteFill style={{ fontFamily: font }}>
    <Backdrop />
    <Sequence from={0} durationInFrames={110}>
      <Scene length={110}>
        <Hook />
      </Scene>
    </Sequence>
    <Sequence from={100} durationInFrames={180}>
      <Scene length={180}>
        <VerifiedSeller />
      </Scene>
    </Sequence>
    <Sequence from={270} durationInFrames={160}>
      <Scene length={160}>
        <WatchFirst />
      </Scene>
    </Sequence>
    <Sequence from={420} durationInFrames={140}>
      <Scene length={140}>
        <Categories />
      </Scene>
    </Sequence>
    <Sequence from={550} durationInFrames={160}>
      <Scene length={160}>
        <Contact />
      </Scene>
    </Sequence>
    <Sequence from={700} durationInFrames={200}>
      <Scene length={200}>
        <EndCard />
      </Scene>
    </Sequence>
  </AbsoluteFill>
);
