import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * 30-second portrait film for buyers, v2 of BuyerPromo. Product-led: a drawn mock of the
 * VerifyMzansi app carries the story (verified seller → watch the video → three sections →
 * contact directly). Brand fonts, kinetic type, grain. All people, items and prices are
 * illustrative; no real user content is shown.
 */

const c = {
  ink: "#03201a",
  green950: "#052e25",
  green900: "#08624a",
  green700: "#0b7a55",
  green500: "#10b981",
  green300: "#6ee7b7",
  gold: "#f9a826",
  gold300: "#fcd34d",
  gold100: "#fef3c7",
  blue: "#2563eb",
  blue300: "#93c5fd",
  teal: "#0f766e",
  teal300: "#5eead4",
  white: "#ffffff",
  soft: "rgba(255,255,255,0.74)",
  slate: "#475569",
  line: "#e2e8f0",
  whatsapp: "#25d366",
};

const display = '"Bricolage Grotesque", "Segoe UI", system-ui, sans-serif';
const body = '"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const p = (frame: number, from: number, to: number, easing = ease) =>
  interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

/* ───────────────────────── fonts ───────────────────────── */

const useBrandFonts = () => {
  const [handle] = useState(() => delayRender("Loading brand fonts"));
  useEffect(() => {
    const faces = [
      new FontFace(
        "Bricolage Grotesque",
        `url(${staticFile("fonts/video/bricolage-grotesque-latin.woff2")}) format("woff2")`,
        { weight: "200 800" }
      ),
      new FontFace(
        "Plus Jakarta Sans",
        `url(${staticFile("fonts/video/plus-jakarta-sans-latin.woff2")}) format("woff2")`,
        { weight: "200 800" }
      ),
    ];
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => loaded.forEach((f) => document.fonts.add(f)))
      .finally(() => continueRender(handle));
  }, [handle]);
};

/* ───────────────────────── atmosphere ───────────────────────── */

const Backdrop = () => {
  const frame = useCurrentFrame();
  const a = Math.sin(frame / 50) * 80;
  const b = Math.cos(frame / 60) * 70;
  return (
    <AbsoluteFill style={{ background: c.green950, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: -300 + a,
          top: -200,
          width: 1100,
          height: 1100,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(11,122,85,0.9) 0%, rgba(11,122,85,0) 65%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -380 + b,
          bottom: -260,
          width: 1200,
          height: 1200,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(249,168,38,0.32) 0%, rgba(249,168,38,0) 60%)",
        }}
      />
      {/* faint diagonal Mzansi pattern */}
      <svg width="1080" height="1920" style={{ position: "absolute", inset: 0, opacity: 0.06 }}>
        <defs>
          <pattern id="mz" width="90" height="90" patternUnits="userSpaceOnUse">
            <path d="M0 45 L45 0 L90 45 L45 90 Z" fill="none" stroke="#fff" strokeWidth="1.5" />
            <circle cx="45" cy="45" r="4" fill="#fff" />
          </pattern>
        </defs>
        <rect width="1080" height="1920" fill="url(#mz)" />
      </svg>
    </AbsoluteFill>
  );
};

/** Animated film grain + vignette, drawn over everything. */
const Finish = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg
        width="1080"
        height="1920"
        style={{ position: "absolute", inset: 0, opacity: 0.07, mixBlendMode: "overlay" }}
      >
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 12} />
        </filter>
        <rect width="1080" height="1920" filter="url(#grain)" />
      </svg>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)",
        }}
      />
      {/* South African flag stripe */}
      <div
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 12, display: "flex" }}
      >
        {["#007a4d", "#ffb612", "#ffffff", "#de3831", "#ffffff", "#002395", "#000000"].map(
          (col, i) => (
            <div key={i} style={{ flex: 1, background: col }} />
          )
        )}
      </div>
    </AbsoluteFill>
  );
};

/** Story-style progress segments, one per chapter. */
const StoryBars = ({ marks }: { marks: number[] }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", top: 54, left: 48, right: 48, display: "flex", gap: 10 }}>
      {marks.slice(0, -1).map((start, i) => {
        const end = marks[i + 1];
        const fill = interpolate(frame, [start, end], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={start}
            style={{ flex: 1, height: 7, borderRadius: 4, background: "rgba(255,255,255,0.22)" }}
          >
            <div
              style={{
                width: `${fill * 100}%`,
                height: "100%",
                borderRadius: 4,
                background: c.white,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

/* ───────────────────────── type ───────────────────────── */

/** Words rise out of a mask one after another. */
const Kinetic = ({
  text,
  size,
  delay = 0,
  stagger = 4,
  gold = [],
  align = "left",
  style,
}: {
  text: string;
  size: number;
  delay?: number;
  stagger?: number;
  gold?: string[];
  align?: "left" | "center";
  style?: CSSProperties;
}) => {
  const frame = useCurrentFrame();
  const lines = text.split("\n");
  let index = 0;
  return (
    <div
      style={{
        fontFamily: display,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 0.98,
        letterSpacing: "-0.035em",
        color: c.white,
        textAlign: align,
        ...style,
      }}
    >
      {lines.map((line, li) => (
        <div
          key={li}
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: align === "center" ? "center" : "flex-start",
            columnGap: size * 0.24,
          }}
        >
          {line.split(" ").map((word) => {
            const t = p(frame, delay + index * stagger, delay + index * stagger + 18);
            index++;
            const isGold = gold.some((g) => word.replace(/[.,?!]/g, "") === g);
            return (
              <span
                key={word + index}
                style={{
                  display: "inline-block",
                  overflow: "hidden",
                  paddingBottom: size * 0.12,
                  marginBottom: -size * 0.12,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    transform: `translateY(${(1 - t) * 110}%) rotate(${(1 - t) * 6}deg)`,
                    transformOrigin: "left bottom",
                    color: isGold ? c.gold300 : undefined,
                  }}
                >
                  {word}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const Kicker = ({
  children,
  delay = 0,
  color = c.gold300,
}: {
  children: ReactNode;
  delay?: number;
  color?: string;
}) => {
  const frame = useCurrentFrame();
  const t = p(frame, delay, delay + 16);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        opacity: t,
        transform: `translateX(${(1 - t) * -30}px)`,
      }}
    >
      <div style={{ width: 60 * t, height: 4, borderRadius: 2, background: color }} />
      <div
        style={{ fontFamily: body, fontWeight: 800, fontSize: 30, letterSpacing: "0.22em", color }}
      >
        {children}
      </div>
    </div>
  );
};

/* ───────────────────────── icons ───────────────────────── */

const Icon = ({
  d,
  size = 40,
  color = "currentColor",
  stroke = 2.2,
}: {
  d: string;
  size?: number;
  color?: string;
  stroke?: number;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);
const ic = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  bag: "M6 7h12l1 13H5L6 7zM9 7a3 3 0 0 1 6 0",
  building: "M4 21V5l8-3v19M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20",
  palm: "M12 22V11M12 11C9 7 5 7 3 9M12 11c3-4 7-4 9-2M12 11c-1-4-4-6-7-6M12 11c1-4 4-6 7-6",
  phone:
    "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  home: "M3 11l9-7 9 7M5 10v10h14V10",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  plus: "M12 5v14M5 12h14",
  pin: "M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  idcard: "M3 6h18v12H3zM7 10h4M7 14h6M15.5 11.5a1.5 1.5 0 1 0 0-.01",
  selfie:
    "M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7.5 17a5 5 0 0 1 9 0",
};

/* ───────────────────────── illustrations ───────────────────────── */

/** Warm living room with a couch: the "item" in the video. */
const LivingRoom = ({ frame, w, h }: { frame: number; w: number; h: number }) => {
  const sweep = ((frame * 6) % (w * 2.4)) - w * 0.7;
  const s = w / 600;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "linear-gradient(180deg,#f6ead8 0%,#ecd9bd 64%,#b9875a 64%,#9a6c43 100%)",
      }}
    >
      {/* window */}
      <div
        style={{
          position: "absolute",
          left: 60 * s,
          top: 70 * s,
          width: 170 * s,
          height: 220 * s,
          borderRadius: 14 * s,
          background: "linear-gradient(180deg,#bfe3f5,#e8f6fb)",
          border: `${10 * s}px solid #fff8ee`,
        }}
      />
      {/* frame on wall */}
      <div
        style={{
          position: "absolute",
          right: 80 * s,
          top: 110 * s,
          width: 140 * s,
          height: 100 * s,
          borderRadius: 8 * s,
          background: c.green700,
          border: `${8 * s}px solid #e2c48f`,
        }}
      />
      {/* plant */}
      <div
        style={{
          position: "absolute",
          right: 40 * s,
          bottom: h * 0.36 - 2 * s,
          width: 70 * s,
          height: 80 * s,
          borderRadius: `0 0 ${16 * s}px ${16 * s}px`,
          background: "#7c4a2a",
        }}
      />
      {[-30, 0, 30].map((r) => (
        <div
          key={r}
          style={{
            position: "absolute",
            right: 55 * s,
            bottom: h * 0.36 + 70 * s,
            width: 40 * s,
            height: 120 * s,
            borderRadius: "50%",
            background: "#2f7d4f",
            transform: `rotate(${r}deg)`,
            transformOrigin: "bottom center",
          }}
        />
      ))}
      {/* couch */}
      <div
        style={{
          position: "absolute",
          left: 90 * s,
          bottom: h * 0.3,
          width: 420 * s,
          height: 220 * s,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 40 * s,
            top: 0,
            width: 340 * s,
            height: 120 * s,
            borderRadius: `${44 * s}px ${44 * s}px ${10 * s}px ${10 * s}px`,
            background: "#2f6f5e",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 70 * s,
            width: 70 * s,
            height: 120 * s,
            borderRadius: 30 * s,
            background: "#28604f",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 70 * s,
            width: 70 * s,
            height: 120 * s,
            borderRadius: 30 * s,
            background: "#28604f",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 50 * s,
            top: 100 * s,
            width: 320 * s,
            height: 80 * s,
            borderRadius: 24 * s,
            background: "#3a8370",
            boxShadow: `0 ${16 * s}px ${30 * s}px rgba(0,0,0,0.25)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 90 * s,
            top: 50 * s,
            width: 90 * s,
            height: 70 * s,
            borderRadius: 18 * s,
            background: c.gold300,
            transform: "rotate(-10deg)",
          }}
        />
        {[40, 360].map((left) => (
          <div
            key={left}
            style={{
              position: "absolute",
              left: left * s,
              top: 185 * s,
              width: 18 * s,
              height: 34 * s,
              borderRadius: 4 * s,
              background: "#3b2414",
            }}
          />
        ))}
      </div>
      {/* camera light sweep */}
      <div
        style={{
          position: "absolute",
          top: -100,
          bottom: -100,
          left: sweep,
          width: 160 * s,
          background:
            "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.35), rgba(255,255,255,0))",
          transform: "rotate(14deg)",
        }}
      />
    </div>
  );
};

const Bakery = () => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: "linear-gradient(180deg,#dbeafe 0%,#bfdbfe 60%,#1e3a8a 60%)",
    }}
  >
    <div
      style={{
        position: "absolute",
        left: "15%",
        right: "15%",
        top: "28%",
        height: "34%",
        background: "#fff",
        borderRadius: 10,
      }}
    />
    <div
      style={{
        position: "absolute",
        left: "12%",
        right: "12%",
        top: "22%",
        height: "9%",
        background: `repeating-linear-gradient(90deg, ${c.blue} 0 30px, #fff 30px 60px)`,
        borderRadius: 8,
      }}
    />
  </div>
);

const Lodge = () => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: "linear-gradient(180deg,#fdba74 0%,#fde68a 45%,#14532d 45%,#166534 100%)",
    }}
  >
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "22%",
        width: 90,
        height: 90,
        marginLeft: -45,
        borderRadius: "50%",
        background: "#fff7ed",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: "18%",
        top: "38%",
        width: 0,
        height: 0,
        borderLeft: "70px solid transparent",
        borderRight: "70px solid transparent",
        borderBottom: `90px solid ${c.teal}`,
      }}
    />
  </div>
);

/* ───────────────────────── app mock ───────────────────────── */

const Phone = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      position: "relative",
      width: 640,
      height: 1310,
      borderRadius: 92,
      background: "#0b1512",
      padding: 18,
      boxShadow: "0 80px 160px rgba(0,0,0,0.55), inset 0 0 0 3px rgba(255,255,255,0.08)",
      ...style,
    }}
  >
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 76,
        overflow: "hidden",
        background: "#f8faf9",
      }}
    >
      {children}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: "50%",
          width: 170,
          height: 44,
          marginLeft: -85,
          borderRadius: 30,
          background: "#0b1512",
        }}
      />
    </div>
  </div>
);

const AppHeader = () => (
  <div style={{ paddingTop: 84, paddingInline: 30, background: "#fbfaf6" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <Img
        src={staticFile("images/brand-shield-small.png")}
        style={{ width: 64, height: 64, objectFit: "contain" }}
      />
      <div style={{ lineHeight: 1 }}>
        <div
          style={{
            fontFamily: body,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.2em",
            color: c.slate,
          }}
        >
          TRUSTED MARKETPLACE
        </div>
        <div
          style={{
            fontFamily: display,
            fontSize: 34,
            fontWeight: 800,
            color: c.green950,
            letterSpacing: "-0.02em",
          }}
        >
          Verify <span style={{ color: c.green700 }}>Mzansi</span>
        </div>
      </div>
    </div>
    <div
      style={{
        display: "flex",
        gap: 10,
        marginTop: 22,
        padding: 8,
        borderRadius: 26,
        background: "#f1f5f2",
        border: `1px solid ${c.line}`,
      }}
    >
      {[
        { label: "Market", d: ic.bag, col: c.green700, active: true },
        { label: "Business", d: ic.building, col: c.blue },
        { label: "Tourism", d: ic.palm, col: c.teal },
      ].map((t) => (
        <div
          key={t.label}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            height: 56,
            borderRadius: 18,
            background: t.active ? "#fff" : "transparent",
            boxShadow: t.active ? "0 4px 12px rgba(0,0,0,0.08)" : undefined,
            fontFamily: body,
            fontWeight: 700,
            fontSize: 21,
            color: c.green950,
          }}
        >
          <Icon d={t.d} size={24} color={t.col} />
          {t.label}
        </div>
      ))}
    </div>
  </div>
);

const VerifiedPill = ({ scale = 1, style }: { scale?: number; style?: CSSProperties }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8 * scale,
      padding: `${8 * scale}px ${16 * scale}px`,
      borderRadius: 999,
      background: `linear-gradient(145deg, ${c.gold300}, ${c.gold})`,
      color: c.ink,
      fontFamily: body,
      fontWeight: 800,
      fontSize: 20 * scale,
      boxShadow: `0 0 ${30 * scale}px rgba(249,168,38,0.55)`,
      ...style,
    }}
  >
    <Icon d={ic.check} size={22 * scale} color={c.ink} stroke={3.4} />
    Verified seller
  </div>
);

const BottomNav = () => (
  <div
    style={{
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 20,
      height: 112,
      borderRadius: 36,
      background: "#fff",
      boxShadow: "0 -6px 30px rgba(0,0,0,0.1)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-around",
      fontFamily: body,
      fontWeight: 700,
      fontSize: 17,
      color: c.slate,
    }}
  >
    {[
      { l: "Home", d: ic.home, active: true },
      { l: "Verify", d: ic.check },
      { l: "Post", d: ic.plus, post: true },
      { l: "Safety", d: ic.flag },
      { l: "Dashboard", d: ic.user },
    ].map((n) =>
      n.post ? (
        <div
          key={n.l}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -50 }}
        >
          <div
            style={{
              width: 86,
              height: 86,
              borderRadius: "50%",
              background: c.green700,
              border: "6px solid #fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 10px 20px rgba(11,122,85,0.4)",
            }}
          >
            <Icon d={n.d} size={40} color="#fff" stroke={3} />
          </div>
          <span style={{ color: c.green700, fontWeight: 800 }}>Post</span>
        </div>
      ) : (
        <div
          key={n.l}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            color: n.active ? c.green700 : c.slate,
          }}
        >
          <Icon d={n.d} size={32} color={n.active ? c.green700 : c.slate} />
          {n.l}
        </div>
      )
    )}
  </div>
);

/** Home feed: carousel of video posts with the couch post in front. */
const FeedScreen = ({ frame, badgeIn }: { frame: number; badgeIn: number }) => (
  <AbsoluteFill style={{ background: "#eef3f0" }}>
    <AppHeader />
    <div style={{ position: "relative", height: 820, marginTop: 26 }}>
      {/* side cards */}
      <div
        style={{
          position: "absolute",
          left: -330,
          top: 40,
          width: 420,
          height: 720,
          borderRadius: 40,
          overflow: "hidden",
          opacity: 0.85,
          transform: "scale(0.92)",
        }}
      >
        <Bakery />
      </div>
      <div
        style={{
          position: "absolute",
          right: -330,
          top: 40,
          width: 420,
          height: 720,
          borderRadius: 40,
          overflow: "hidden",
          opacity: 0.85,
          transform: "scale(0.92)",
        }}
      >
        <Lodge />
      </div>
      {/* main card */}
      <div
        style={{
          position: "absolute",
          left: 62,
          top: 0,
          width: 480,
          height: 800,
          borderRadius: 44,
          overflow: "hidden",
          background: "#fff",
          boxShadow: "0 30px 60px rgba(0,0,0,0.22)",
        }}
      >
        <div style={{ position: "relative", height: 610 }}>
          <LivingRoom frame={frame} w={480} h={610} />
          <div
            style={{
              position: "absolute",
              top: 22,
              left: 22,
              padding: "8px 16px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.55)",
              color: "#fff",
              fontFamily: body,
              fontWeight: 700,
              fontSize: 20,
            }}
          >
            0:15
          </div>
          <div
            style={{
              position: "absolute",
              top: 18,
              right: 18,
              transform: `scale(${badgeIn})`,
              transformOrigin: "top right",
            }}
          >
            <VerifiedPill />
          </div>
        </div>
        <div style={{ padding: "22px 26px", display: "flex", gap: 16, alignItems: "center" }}>
          <div
            style={{
              width: 66,
              height: 66,
              borderRadius: "50%",
              background: `linear-gradient(145deg, ${c.green700}, ${c.green950})`,
              color: "#fff",
              fontFamily: display,
              fontWeight: 800,
              fontSize: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            TM
          </div>
          <div>
            <div style={{ fontFamily: display, fontWeight: 800, fontSize: 32, color: c.ink }}>
              Green 3-seater couch
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: body,
                fontWeight: 600,
                fontSize: 21,
                color: c.slate,
              }}
            >
              <Icon d={ic.pin} size={22} color={c.slate} /> Durban ·{" "}
              <span style={{ color: c.green700, fontWeight: 800 }}>R2 500</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <BottomNav />
  </AbsoluteFill>
);

/** Listing detail with direct contact buttons. */
const DetailScreen = ({ frame, tapAt }: { frame: number; tapAt: number }) => {
  const tap = p(frame, tapAt, tapAt + 18);
  const press = frame >= tapAt && frame < tapAt + 8 ? 0.95 : 1;
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <div style={{ position: "relative", height: 620 }}>
        <LivingRoom frame={frame} w={604} h={620} />
      </div>
      <div style={{ padding: "30px 34px", display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            fontFamily: display,
            fontWeight: 800,
            fontSize: 44,
            color: c.ink,
            letterSpacing: "-0.02em",
          }}
        >
          Green 3-seater couch
        </div>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: 40, color: c.green700 }}>
          R2 500
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: 16,
            borderRadius: 22,
            background: "#f1f5f2",
          }}
        >
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: "50%",
              background: `linear-gradient(145deg, ${c.green700}, ${c.green950})`,
              color: "#fff",
              fontFamily: display,
              fontWeight: 800,
              fontSize: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            TM
          </div>
          <div style={{ flex: 1, fontFamily: body, fontWeight: 700, fontSize: 24, color: c.ink }}>
            Thabo M.
          </div>
          <VerifiedPill scale={0.85} />
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
          <div
            style={{
              flex: 1,
              height: 92,
              borderRadius: 26,
              border: `3px solid ${c.green700}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              fontFamily: body,
              fontWeight: 800,
              fontSize: 28,
              color: c.green700,
            }}
          >
            <Icon d={ic.phone} size={30} color={c.green700} /> Call
          </div>
          <div
            style={{
              position: "relative",
              flex: 1.3,
              height: 92,
              borderRadius: 26,
              background: c.whatsapp,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: body,
              fontWeight: 800,
              fontSize: 28,
              color: c.ink,
              transform: `scale(${press})`,
              overflow: "hidden",
            }}
          >
            WhatsApp
            <div
              style={{
                position: "absolute",
                width: 400 * tap,
                height: 400 * tap,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.45)",
                opacity: 1 - tap,
              }}
            />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: body,
            fontWeight: 700,
            fontSize: 22,
            color: c.slate,
            marginTop: 4,
          }}
        >
          <Icon d={ic.flag} size={24} color={c.slate} /> Report listing
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ───────────────────────── scenes ───────────────────────── */

/** Scene 1: the doubt. A sketchy listing glitches; kinetic question. */
const Doubt = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = spring({ frame: frame - 2, fps, config: { damping: 16, stiffness: 90 } });
  const glitch = frame > 46 && frame % 7 < 2 ? 1 : 0;
  const stamp = spring({ frame: frame - 50, fps, config: { damping: 8, stiffness: 160 } });
  const exit = p(frame, 92, 112, Easing.in(Easing.cubic));
  return (
    <AbsoluteFill
      style={{
        transform: `translateY(${exit * -260}px) scale(${1 - exit * 0.1})`,
        opacity: 1 - exit,
      }}
    >
      <div style={{ position: "absolute", left: 90, top: 250 }}>
        <Kicker>BUYING ONLINE?</Kicker>
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, top: 330 }}>
        <Kinetic
          text={"Great price.\nNice photos.\nBut is the seller real?"}
          size={112}
          delay={6}
          stagger={4}
          gold={["real"]}
        />
      </div>
      {/* sketchy listing */}
      <div
        style={{
          position: "absolute",
          left: 110,
          top: 1080,
          width: 860,
          padding: 30,
          borderRadius: 40,
          background: "rgba(255,255,255,0.08)",
          border: "2px solid rgba(255,255,255,0.16)",
          display: "flex",
          gap: 28,
          transform: `translateY(${(1 - card) * 200}px) rotate(${-4 + glitch * 2}deg) translateX(${glitch * 14}px) scale(1.12)`,
          opacity: Math.min(1, card),
          filter: glitch ? "hue-rotate(60deg) saturate(2)" : undefined,
        }}
      >
        <div
          style={{
            width: 220,
            height: 220,
            borderRadius: 26,
            background: "linear-gradient(135deg,#94a3b8,#cbd5e1)",
            filter: "blur(6px)",
          }}
        />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              height: 30,
              width: "80%",
              borderRadius: 8,
              background: "rgba(255,255,255,0.35)",
            }}
          />
          <div
            style={{
              height: 24,
              width: "55%",
              borderRadius: 8,
              background: "rgba(255,255,255,0.2)",
            }}
          />
          <div style={{ fontFamily: body, fontWeight: 700, fontSize: 30, color: c.soft }}>
            Seller: unknown
          </div>
          <div
            style={{
              fontFamily: body,
              fontWeight: 600,
              fontSize: 24,
              color: "rgba(255,255,255,0.5)",
            }}
          >
            “Pay deposit first”
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: -30,
            top: -40,
            padding: "14px 26px",
            borderRadius: 16,
            border: "5px solid #f87171",
            color: "#f87171",
            fontFamily: display,
            fontWeight: 800,
            fontSize: 44,
            letterSpacing: "0.04em",
            transform: `rotate(12deg) scale(${2 - stamp})`,
            opacity: Math.min(1, stamp),
          }}
        >
          NOT VERIFIED
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Scene 2: the app. Phone rises in 3D, verified badge lands, checks fan out. */
const Proof = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 18, stiffness: 70 } });
  const tilt = interpolate(frame, [0, 200], [-14, 8]);
  const badge = spring({ frame: frame - 48, fps, config: { damping: 9, stiffness: 140 } });
  const checks = [
    { label: "Phone confirmed", d: ic.phone, at: 76, y: 560 },
    { label: "SA ID reviewed", d: ic.idcard, at: 92, y: 750 },
    { label: "Live selfie matched", d: ic.selfie, at: 108, y: 940 },
    { label: "Post checked first", d: ic.check, at: 124, y: 1130 },
  ];
  const exit = p(frame, 192, 212, Easing.in(Easing.cubic));
  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <div style={{ position: "absolute", left: 80, right: 80, top: 130 }}>
        <Kicker delay={4}>ON VERIFYMZANSI</Kicker>
        <div style={{ height: 22 }} />
        <Kinetic
          text={"Every seller is\nidentity-checked."}
          size={96}
          delay={10}
          stagger={4}
          gold={["identity-checked"]}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 30,
          top: 450,
          perspective: 2400,
          transform: `translateY(${(1 - rise) * 900 + exit * 200}px) scale(${0.98 + exit * 0.1})`,
          transformOrigin: "top left",
        }}
      >
        <div style={{ transform: `rotateY(${tilt}deg) rotateX(4deg)` }}>
          <Phone>
            <FeedScreen frame={frame} badgeIn={badge} />
          </Phone>
        </div>
      </div>
      {checks.map(({ label, d, at, y }) => {
        const t = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 120 } });
        return (
          <div
            key={label}
            style={{
              position: "absolute",
              right: 50,
              top: y + 200,
              transform: `translateX(${(1 - t) * 420}px)`,
              opacity: Math.min(1, t),
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "20px 28px 20px 20px",
                borderRadius: 28,
                background: c.green900,
                border: "2px solid rgba(255,255,255,0.14)",
                boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
                fontFamily: body,
                fontWeight: 800,
                fontSize: 32,
                color: c.white,
              }}
            >
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 18,
                  background: "rgba(252,211,77,0.16)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon d={d} size={34} color={c.gold300} />
              </div>
              {label}
              <Icon d={ic.check} size={34} color={c.green300} stroke={3.2} />
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** Scene 3: zoom into the video. It fills the screen and plays. */
const WatchIt = () => {
  const frame = useCurrentFrame();
  const open = p(frame, 0, 26);
  const played = interpolate(frame, [10, 160], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const zoom = interpolate(frame, [0, 170], [1.06, 1.18]);
  const radius = interpolate(open, [0, 1], [44, 0]);
  const exit = p(frame, 150, 170, Easing.in(Easing.cubic));
  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <div
        style={{
          position: "absolute",
          left: interpolate(open, [0, 1], [130, 0]),
          right: interpolate(open, [0, 1], [450, 0]),
          top: interpolate(open, [0, 1], [870, 0]),
          bottom: interpolate(open, [0, 1], [440, 0]),
          borderRadius: radius,
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})` }}>
          <LivingRoom frame={frame} w={1080} h={1920} />
        </div>
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, rgba(3,32,26,0.85) 0%, rgba(3,32,26,0) 34%, rgba(3,32,26,0) 62%, rgba(3,32,26,0.9) 100%)",
          }}
        />
      </div>
      <div style={{ position: "absolute", left: 80, right: 80, top: 150, opacity: open }}>
        <Kicker delay={18}>WATCH BEFORE YOU GO</Kicker>
        <div style={{ height: 22 }} />
        <Kinetic text={"See the real item.\nOn video."} size={104} delay={24} gold={["video."]} />
      </div>
      <div style={{ position: "absolute", left: 80, right: 80, bottom: 120, opacity: open }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 26,
          }}
        >
          <div>
            <div style={{ fontFamily: display, fontWeight: 800, fontSize: 52, color: c.white }}>
              Green 3-seater couch
            </div>
            <div style={{ fontFamily: body, fontWeight: 700, fontSize: 32, color: c.soft }}>
              Durban · R2 500
            </div>
          </div>
          <VerifiedPill scale={1.3} />
        </div>
        <div style={{ height: 10, borderRadius: 5, background: "rgba(255,255,255,0.3)" }}>
          <div
            style={{
              width: `${played * 100}%`,
              height: "100%",
              borderRadius: 5,
              background: c.gold300,
              boxShadow: `0 0 18px ${c.gold}`,
            }}
          />
        </div>
        <div
          style={{ marginTop: 14, fontFamily: body, fontWeight: 700, fontSize: 26, color: c.soft }}
        >
          0:{String(Math.floor(played * 15)).padStart(2, "0")} / 0:15
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Scene 4: three full-bleed panels, one per section. */
const Sections = () => {
  const frame = useCurrentFrame();
  const panels = [
    {
      name: "Market.",
      line: "Deals from verified sellers near you.",
      d: ic.bag,
      bg: `linear-gradient(160deg, ${c.green700}, ${c.green950})`,
      accent: c.green300,
    },
    {
      name: "Business.",
      line: "Local shops and services you can check.",
      d: ic.building,
      bg: "linear-gradient(160deg, #1d4ed8, #0b1f4f)",
      accent: c.blue300,
    },
    {
      name: "Tourism.",
      line: "Places to stay, things to do, events.",
      d: ic.palm,
      bg: "linear-gradient(160deg, #0f766e, #042f2c)",
      accent: c.teal300,
    },
  ];
  const each = 56;
  const out = p(frame, 158, 170);
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      {panels.map((panel, i) => {
        const start = i * each;
        const enter = p(frame, start, start + 16, Easing.out(Easing.cubic));
        const local = frame - start;
        if (frame < start) return null;
        return (
          <AbsoluteFill
            key={panel.name}
            style={{
              background: panel.bg,
              clipPath: `inset(${(1 - enter) * 100}% 0 0 0)`,
              justifyContent: "center",
              padding: "0 90px",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: -160,
                top: 260,
                opacity: 0.12,
                transform: `rotate(${local * 0.3}deg)`,
              }}
            >
              <Icon d={panel.d} size={820} color={c.white} stroke={1.2} />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 130,
                height: 130,
                borderRadius: 36,
                background: "rgba(255,255,255,0.12)",
                marginBottom: 46,
                opacity: p(local, 6, 18),
              }}
            >
              <Icon d={panel.d} size={74} color={panel.accent} />
            </div>
            <Sequence from={start} layout="none">
              <Kinetic text={panel.name} size={184} delay={4} />
            </Sequence>
            <div
              style={{
                marginTop: 34,
                maxWidth: 820,
                fontFamily: body,
                fontWeight: 700,
                fontSize: 50,
                lineHeight: 1.25,
                color: c.soft,
                opacity: p(local, 14, 28),
                transform: `translateY(${(1 - p(local, 14, 28)) * 30}px)`,
              }}
            >
              {panel.line}
            </div>
          </AbsoluteFill>
        );
      })}
      <div style={{ position: "absolute", left: 90, top: 200 }}>
        <Kicker delay={4} color={c.white}>
          FIND IT LOCAL
        </Kicker>
      </div>
    </AbsoluteFill>
  );
};

/** Scene 5: listing detail, tap WhatsApp, message bubble. */
const Reach = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 18, stiffness: 80 } });
  const tapAt = 60;
  const bubble = spring({
    frame: frame - tapAt - 14,
    fps,
    config: { damping: 12, stiffness: 140 },
  });
  const reply = spring({ frame: frame - tapAt - 44, fps, config: { damping: 12, stiffness: 140 } });
  const exit = p(frame, 150, 168, Easing.in(Easing.cubic));
  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <div style={{ position: "absolute", left: 80, right: 80, top: 130 }}>
        <Kicker delay={2}>NO MIDDLE STEPS</Kicker>
        <div style={{ height: 22 }} />
        <Kinetic
          text={"Call or WhatsApp\nthe seller directly."}
          size={92}
          delay={8}
          gold={["directly."]}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 220,
          top: 560,
          transform: `translateY(${(1 - rise) * 1000}px) rotate(${(1 - rise) * 8 + 3}deg)`,
        }}
      >
        <Phone style={{ transform: "scale(0.98)" }}>
          <DetailScreen frame={frame} tapAt={tapAt} />
        </Phone>
      </div>
      {/* chat bubbles (illustrative) */}
      <div
        style={{
          position: "absolute",
          left: 50,
          top: 860,
          transform: `scale(${bubble})`,
          transformOrigin: "left bottom",
        }}
      >
        <div
          style={{
            maxWidth: 560,
            padding: "26px 32px",
            borderRadius: "34px 34px 34px 8px",
            background: "#dcf8c6",
            color: c.ink,
            fontFamily: body,
            fontWeight: 700,
            fontSize: 34,
            boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
          }}
        >
          Hi Thabo, is the couch still available?
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 50,
          top: 1030,
          transform: `scale(${reply})`,
          transformOrigin: "right bottom",
        }}
      >
        <div
          style={{
            maxWidth: 560,
            padding: "26px 32px",
            borderRadius: "34px 34px 8px 34px",
            background: c.white,
            color: c.ink,
            fontFamily: body,
            fontWeight: 700,
            fontSize: 34,
            boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
          }}
        >
          Yes! Come see it today 👍
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Scene 6: emblem with orbiting chips, line, URL. */
const Finale = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shield = spring({ frame: frame - 2, fps, config: { damping: 10, stiffness: 80 } });
  const ring = (delay: number) => p(frame, delay, delay + 30);
  const chips = [
    { label: "Phone verified", angle: -150 },
    { label: "SA ID checked", angle: -30 },
    { label: "Verified seller", angle: 90, gold: true },
  ];
  const url = spring({ frame: frame - 70, fps, config: { damping: 12, stiffness: 110 } });
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div style={{ position: "absolute", top: 260, width: 760, height: 760, left: 160 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: i * 90,
              borderRadius: "50%",
              border: `2px solid rgba(252,211,77,${0.35 - i * 0.08})`,
              transform: `scale(${0.6 + ring(4 + i * 6) * 0.4}) rotate(${frame * (i % 2 ? -0.4 : 0.3)}deg)`,
              opacity: ring(4 + i * 6),
              borderStyle: i === 1 ? "dashed" : "solid",
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Img
            src={staticFile("images/brand-shield.png")}
            style={{
              width: 360,
              transform: `scale(${shield}) rotate(${(1 - shield) * -20}deg)`,
              filter: `drop-shadow(0 0 ${50 + Math.sin(frame / 8) * 20}px rgba(249,168,38,0.6))`,
            }}
          />
        </div>
        {chips.map(({ label, angle, gold }, i) => {
          const t = spring({
            frame: frame - 24 - i * 8,
            fps,
            config: { damping: 12, stiffness: 120 },
          });
          const a = ((angle + frame * 0.15) * Math.PI) / 180;
          const r = 330;
          return (
            <div
              key={label}
              style={{
                position: "absolute",
                left: 380 + Math.cos(a) * r,
                top: 380 + Math.sin(a) * r,
                transform: `translate(-50%, -50%) scale(${t})`,
                padding: "16px 28px",
                borderRadius: 999,
                background: gold ? `linear-gradient(145deg, ${c.gold300}, ${c.gold})` : c.green900,
                border: gold ? undefined : "2px solid rgba(255,255,255,0.18)",
                color: gold ? c.ink : c.white,
                fontFamily: body,
                fontWeight: 800,
                fontSize: 30,
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: 10,
                boxShadow: "0 16px 30px rgba(0,0,0,0.35)",
              }}
            >
              <Icon d={ic.check} size={28} color={gold ? c.ink : c.green300} stroke={3.4} />
              {label}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", top: 1110, left: 60, right: 60 }}>
        <Kinetic
          text={"Buy local.\nBuy verified."}
          size={150}
          delay={36}
          stagger={5}
          gold={["verified."]}
          align="center"
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 1530,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "26px 52px",
          borderRadius: 999,
          background: c.white,
          color: c.green950,
          fontFamily: display,
          fontWeight: 800,
          fontSize: 54,
          transform: `scale(${url})`,
          boxShadow: "0 30px 60px rgba(0,0,0,0.4)",
        }}
      >
        <Img
          src={staticFile("images/brand-shield-small.png")}
          style={{ width: 56, height: 56, objectFit: "contain" }}
        />
        verifymzansi.com
      </div>
    </AbsoluteFill>
  );
};

/* ───────────────────────── film ───────────────────────── */

const marks = [0, 100, 292, 452, 615, 770, 900];

export const BuyerFilm = () => {
  useBrandFonts();
  return (
    <AbsoluteFill style={{ fontFamily: body }}>
      <Backdrop />
      <Sequence from={0} durationInFrames={115}>
        <Doubt />
      </Sequence>
      <Sequence from={100} durationInFrames={212}>
        <Proof />
      </Sequence>
      <Sequence from={292} durationInFrames={170}>
        <WatchIt />
      </Sequence>
      <Sequence from={452} durationInFrames={170}>
        <Sections />
      </Sequence>
      <Sequence from={615} durationInFrames={168}>
        <Reach />
      </Sequence>
      <Sequence from={770} durationInFrames={130}>
        <Finale />
      </Sequence>
      <StoryBars marks={marks} />
      <Finish />
    </AbsoluteFill>
  );
};
